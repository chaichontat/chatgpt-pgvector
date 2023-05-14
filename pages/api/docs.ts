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

  const { question } = (await req.json()) as {
    question?: string;
  };

  if (!question) {
    return new Response("No prompt in the request", { status: 400 });
  }

  const query = question;

  // OpenAI recommends replacing newlines with spaces for best results
  const input = query.replace(/\n/g, " ");
  // console.log("input: ", input);

  const apiKey = process.env.OPENAI_API_KEY;

  const apiURL =
    process.env.OPENAI_PROXY == ""
      ? "https://api.openai.com"
      : process.env.OPENAI_PROXY;

  // const embeddingResponse = await fetch(apiURL + "/v1/embeddings", {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${apiKey}`,
  //     "Content-Type": "application/json"
  //   },
  //   body: JSON.stringify({
  //     input,
  //     model: "text-embedding-ada-002"
  //   })
  // });
  const embedding = await fetch(
    "http://100.64.128.70:8000?" + new URLSearchParams({ question: input })
  ).then((res) => res.text());

  // console.log(embedding);

  // const embeddingData = await embeddingResponse.json();
  // const [{ embedding }] = embeddingData.data;
  // console.log("embedding: ", embedding);

  const { data: documents, error } = await supabaseClient.rpc(
    "match_documents",
    {
      query_embedding: embedding,
      similarity_threshold: 0.1, // Choose an appropriate threshold for your data
      match_count: 10 // Choose the number of matches
    }
  );

  if (error) console.error(error);

  const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
  let tokenCount = 0;
  let contextText = "";

  // console.log("documents: ", documents);

  // Concat matched documents
  if (!documents) {
    return new Response({ error: "No documents found" }, { status: 404 });
  }

  for (let i = 0; i < documents.length; i++) {
    const document = documents[i];
    const content = document.content;
    const doi = document.doi;
    const encoded = tokenizer.encode(content);
    tokenCount += encoded.text.length;

    // Limit context to max 1500 tokens (configurable)
    if (tokenCount > 1500) {
      break;
    }

    contextText += `${content.trim()}\nSOURCE: ${doi}\n---\n`;
  }

  console.log(tokenCount);

  // console.log("contextText: ", contextText);

  const systemContent =
    stripIndent(`You are an expert scientist in neuroscience. The CONTEXT is an excerpt from a scientific paper.
  Use CONTEXT as an extension to your training data. You can use your general scientific knowledge in addition to CONTEXT. Think step-by-step on how CONTEXT can be used to clarify and increase the detail of your answer. Be thorough, rigorous, and always provide evidence to support your claims. You are especially good at making points clear. Use precise language and incorporate relevant technical terms or jargon, as this will be helpful in understanding the subject matter. Keep relevant citation information.
  If you are unsure, you say "Sorry, I don't know."

  The CONTEXT includes DOIs, always include them under a SOURCES heading at the end of your response. Always include all of the relevant DOI from the CONTEXT, but never list a DOI more than once. Never include DOIs that are not in the CONTEXT sections. Never make up URLs.`);

  const userContent = stripIndent(`CONTEXT:
  Hypothalamic tanycytes are radial glial cells that line the ventricular walls of the mediobasal third ventricle (1, 2). Tanycytes are subdivided into alpha1, alpha2, beta1, and beta2 subtypes based on dorsoventral position and marker gene expression and closely resemble neural progenitors in morphology and gene expression profile. Tanycytes have been reported to generate small numbers of neurons and glia in the postnatal period, although at much lower levels than in more extensively characterized sites of ongoing neurogenesis, such as the subventricular zone of the lateral ventricles or the subgranular zone of the dentate gyrus (3–6).
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

  const userMessage = `CONTEXT:
  ${contextText}

  USER QUESTION:
  ${query}
  `;

  const messages = [
    {
      role: "system",
      content: systemContent
    },
    {
      role: "user",
      content: userContent
    },
    {
      role: "assistant",
      content: assistantContent
    },
    {
      role: "user",
      content: userMessage
    }
  ];

  console.log("messages: ", messages);

  const payload: OpenAIStreamPayload = {
    model: "gpt-3.5-turbo",
    messages: messages,
    temperature: 0,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 1000,
    stream: true,
    n: 1
  };

  const stream = await OpenAIStream(payload);
  return new Response(stream);
};

export default handler;
