import { supabaseClient } from "@/lib/embeddings-supabase";
import { OpenAIStream, OpenAIStreamPayload } from "@/utils/OpenAIStream";
import { oneLine, stripIndent } from "common-tags";
import GPT3Tokenizer from "gpt3-tokenizer";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type"
};

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing env var from OpenAI");
}

export const config = {
  runtime: "edge"
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    console.log("req.method ", req.method);
    return new Response("ok", { headers: corsHeaders });
  }

  // console.log(req);

  const { question, keywords, maxChunks, useFakeAnswer } = (await req.json()) as {
    question?: string;
    keywords?: string;
    maxChunks?: number;
    useFakeAnswer?: boolean;
  };
  console.log(question);

  if (!question) {
    return new Response("No prompt in the request", { status: 400 });
  }

  const query = question;

  // OpenAI recommends replacing newlines with spaces for best results
  let input = query.replace(/\n/g, " ");
  // console.log("input: ", input);

  const apiKey = process.env.OPENAI_API_KEY;
  const apiURL =
    process.env.OPENAI_PROXY == ""
      ? "https://api.openai.com"
      : process.env.OPENAI_PROXY;

  if (useFakeAnswer) {
    const initial = await OpenAIStream({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant."
        },
        {
          role: "user",
          content: `As a world-renowned biologist, write an answer to the following question in 2-3 sentences. Be very specific and use technical terms without any restraint. Just assume everything that is not known.  \n\nQ: ${ input }`
        }
      ],
      temperature: 0.5,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_tokens: 1000,
      stream: true,
      n: 1
    });

    const reader = initial.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let fakeAnswer = "";

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      fakeAnswer = fakeAnswer + decoder.decode(value);
    }
    console.log("fakeAnswer: ", fakeAnswer);
    input = fakeAnswer
  }

  const embeddingResponse = await fetch(apiURL + "/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ apiKey }`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: input,
      model: "text-embedding-ada-002"
    })
  });
  const embeddingData = await embeddingResponse.json();
  const [{ embedding }] = embeddingData.data;

  // const embedding = await fetch(
  //   "http://100.64.128.70:8000?" + new URLSearchParams({ question: input })
  // ).then((res) => res.text());

  // console.log("embedding: ", embedding);

  // const { data: documents, error } = await supabaseClient.rpc(
  //   "match_documents",
  //   {
  //     query_embedding: embedding,
  //     similarity_threshold: 0.1, // Choose an appropriate threshold for your data
  //     match_count: 60 // Choose the number of matches
  //   }
  // );
  console.log("keywords: ", keywords)
  const { data: documents, error } = await supabaseClient.rpc(
    keywords ? "match_keywords" : "match_documents",
    {
      query_embedding: embedding,
      similarity_threshold: 0.3, // Choose an appropriate threshold for your data
      match_count: 100, // Choose the number of matches
      keywords: keywords ? keywords.split(",").map((x) => x.trim()) : undefined
    }
  );

  const _dois: string[] = Array.from(
    new Set(documents.map((doc: { doi: string }) => doc.doi))
  );
  const dois: Record<string, number[]> = {};
  for (const [i, doi] of _dois.entries()) {
    if (!(doi in dois)) {
      dois[doi] = [i];
    } else {
      dois[doi].push(i);
    }
  }

  // if (error) console.error(error);

  const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
  let tokenCount = 0;
  let contextText = "";

  console.log("documents: ", documents);

  // Concat matched documents
  if (!documents) {
    return new Response("No documents found", { status: 404 });
  }

  const counts: Record<string, number> = {};

  for (let i = 0; i < documents.length; i++) {
    const document = documents[i];
    const content = document.content;
    const doi = document.doi;
    if (!(doi in counts)) {
      counts[doi] = 0;
    } else {
      counts[doi] += 1;
    }
    if (counts[doi] > (maxChunks ?? 10)) {
      continue;
    }
    const encoded = tokenizer.encode(content);
    tokenCount += encoded.text.length;

    // Limit context to max 1500 tokens (configurable)
    if (tokenCount > 6000) {
      break;
    }

    contextText += `${ content.trim() }\nSOURCE: ${ doi }\n---\n`;
  }

  console.log(tokenCount);

  // console.log("contextText: ", contextText);

  const systemContent =
    stripIndent(`"You are a research assistant who values precision and factuality.
  You will only reply in a straightforward manner in bullet points. Never say "as an AI language model"; never use hedging language like "but remember that", never tack on "However, note that..." or "Remember that..." or "Please note that...", or anything similar at the ends of replies.
  Your goal is to answer QUESTION thoroughly and correctly using as much of the CONTEXT as possible.
  Think step-by-step on how CONTEXT can be used to clarify and increase the detail of your answer.
  You must absolutely ensure the reference matches what you say in the answer.
  Use precise language and incorporate relevant technical terms or jargon as the reader is an expert scientist.
  I do not appreciate layman's terms or vague/general language.
  Do not include a summary (i.e. overall...). I want only facts. Be direct.
  If you are unsure, you say "Sorry, I don't know."
  The CONTEXT includes DOIs, always include them under a SOURCES heading at the end of your response.
  Always list all DOIs from the CONTEXT, but never list a DOI more than once.
  Never include DOIs that are not in the CONTEXT sections.`);

  const userContent = stripIndent(`CONTEXT:
  From this reference, hypothalamic tanycytes are radial glial cells that line the ventricular walls of the mediobasal third ventricle. Tanycytes are subdivided into alpha1, alpha2, beta1, and beta2 subtypes based on dorsoventral position and marker gene expression and closely resemble neural progenitors in morphology and gene expression profile. Tanycytes have been reported to generate small numbers of neurons and glia in the postnatal period, although at much lower levels than in more extensively characterized sites of ongoing neurogenesis, such as the subventricular zone of the lateral ventricles or the subgranular zone of the dentate gyrus.
  SOURCE: 10.1126/sciadv.abg3777
  ---

  QUESTION:
  what are tanycytes and why are they important?
  `);

  const assistantContent =
    stripIndent(`Tanycytes are a specific type of radial glial cells located in the hypothalamus, lining the ventricular walls of the mediobasal third ventricle. The importance of tanycytes lies in their reported capacity to generate neurons and glia, though at much lower levels compared to other well-characterized neurogenic sites like the subventricular zone of the lateral ventricles or the subgranular zone of the dentate gyrus. Despite the relatively low levels of postnatal neurogenesis, the neurons generated from tanycytes, referred to as tanycyte-derived neurons (TDNs), may have significant roles in regulating various behaviors.

A point of interest in the study of tanycytes is their similarity to retinal Müller glia in terms of morphology and gene expression. Müller glia, particularly in zebrafish, act as quiescent neural stem cells capable of regenerating every major retinal cell type after injury. The study of these cells provides valuable insights into the neurogenic potential of tanycytes.

SOURCES:
10.1126/sciadv.abg3777`);

  const userMessage = stripIndent(`CONTEXT:
  ${ contextText }

  QUESTION:
  Do not include a summary (i.e. overall...). Answer in a precise and technical manner from CONTEXT, ${ query }
  `);

  const messages = [
    {
      role: "system",
      content: systemContent.replace("\n", " ")
    },
    {
      role: "user",
      content: userContent.replace("\n", " ")
    },
    {
      role: "assistant",
      content: assistantContent.replace("\n", " ")
    },
    {
      role: "user",
      content: userMessage.replace("\n", " ")
    }
  ];

  console.log("messages: ", messages);

  const payload: OpenAIStreamPayload = {
    model: "gpt-3.5-turbo-16k",
    messages: messages,
    temperature: 0.5,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 1500,
    stream: true,
    n: 1,
    logit_bias: { 18049: -100, 1593: -100, 3465: -100, 7247: -100, 2102: -100, 11: -2 } // remove important, note, understood, however
  };

  const stream = await OpenAIStream(payload);
  return new Response(stream);
};

export default handler;
