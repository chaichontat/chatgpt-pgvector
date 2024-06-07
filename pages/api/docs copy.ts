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

  const { question, keywords, maxChunks, useFakeAnswer, longContext } =
    (await req.json()) as {
      question?: string;
      keywords?: string;
      maxChunks?: number;
      useFakeAnswer?: boolean;
      longContext?: boolean;
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
    input = fakeAnswer;
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
  console.log("keywords: ", keywords);
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

  // const doiset = new Set(documents.map((doc: { doi: string }) => doc.doi))
//   for (const [doi, docs] of Object.entries(dois)) {
//     contextText += "TITLE: " + documents[docs[0]].content.split(". ")[0] + "\n";
//     contextText += "DOI: " + doi + "\n";
//     contextText += docs.map(doc => documents[doc].content.split(". ").slice(1).join(". ")).join(" [...] ")
//     contextText += "\n---\n";


// }
  const outText: { doi: string, content: string }[] = []

  for (let i = 0; i < documents.length; i++) {
    const document = documents[i];
    const content = document.content;
    const doi = document.doi;

       if (counts[doi] > (maxChunks ?? 10)) {
      continue;
        }

    if (!(doi in counts)) {
      counts[doi] = 0;
    } else {
      counts[doi] += 1;
    }

    let idx = outText.map(x => x.doi).indexOf(doi);
    if (idx == -1) {
      outText.push({ doi, content: "" })
      idx = outText.length - 1;
      outText[idx].content += "TITLE: " + content.split(". ")[0] + "\n";
      outText[idx].content += "DOI: " + doi + "\n[...]  ";
    }

    const actualContent = content.split(". ").slice(1).join(". ");
    outText[idx].content += actualContent + " [...] ";

    const encoded = tokenizer.encode(actualContent);
    tokenCount += encoded.text.length;

    // Limit context to max 1500 tokens (configurable)
    if (tokenCount > (longContext ? 6000 : 2000)) {
      break;
    }
    // contextText += `${ content.trim() }\nSOURCE: ${ doi }\n---\n`;
  }

  contextText = outText.map(x => x.content).join("\n---\n");

  console.log(tokenCount);

  const functions = [
    {
      "name": "parse_answer",
      // "description": "Parse answer along with its sources",
      //  "type": "object",
      //       "properties": {
      //           "text": {
      //               "type": "string",
      //               "description": "Your answer",
      //           },
      //           "source": {
      //               "type": "string",
      //               "description": "Sources of the answer",
      //           },
      //       },
      // "required": ["text", "source"],

      // "parameters": {
      //   "type": "array",
      //   "items": {
      //     "type": "object",
      //     "required": ["text", "sources"],
      //     "properties": {
      //       "text": {
      //         "type": "string",
      //         "description": "Part of the answer attributable to the source",
      //       },
      //       "sources": {
      //         "type": "array",
      //         "items": {
      //           "type": "string",
      //           "description": "Sources of the answer"
      //         }
      //       }
      //     }
      //   },
      // }
    }
  ]

  // console.log("contextText: ", contextText);

  const systemContent =
    stripIndent(`"You are a research assistant who values precision and factuality.
  You will only reply in a straightforward manner in bullet points.
  Your goal is to answer QUESTION thoroughly and correctly using as much of the CONTEXT as possible.
  The CONTEXT is a list of independent facts that you can use to answer the QUESTION.
  Do not assume that text from different CONTEXT sections are related.
  Think step-by-step on how CONTEXT can be used to clarify and increase the detail of your answer.
  You must absolutely ensure the reference matches what you say in the answer.
  Use precise language and incorporate relevant technical terms or jargon as the reader is an expert scientist.
  You will utilize as much technical terms/keywords as possible.
  I do not appreciate layman's terms or vague/general language.
  If you are unsure, you say "Sorry, I don't know. Please add relevant papers to my database."
  The CONTEXT includes DOIs, always include them under a SOURCES heading at the very end of your response.
  Always list all DOIs from the CONTEXT, but never list a DOI more than once.
  Never include DOIs that are not in the CONTEXT sections.`);

  const userContent = stripIndent(`CONTEXT:
  ===
  TITLE: Control of neurogenic competence in mammalian hypothalamic tanycytes
  DOI: 10.1126/sciadv.abg3777
  [...] Hypothalamic tanycytes are radial glial cells that line the ventricular walls of the mediobasal third ventricle. Tanycytes are subdivided into alpha1, alpha2, beta1, and beta2 subtypes based on dorsoventral position and marker gene expression and closely resemble neural progenitors in morphology and gene expression profile. Tanycytes have been reported to generate small numbers of neurons and glia in the postnatal period, although at much lower levels than in more extensively characterized sites of ongoing neurogenesis, such as the subventricular zone of the lateral ventricles or the subgranular zone of the dentate gyrus. [...]
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
  ---
  ${ contextText }

  QUESTION:
  Answer in a precise and technical manner from CONTEXT and include the SOURCES section at the end of your answer, ${query}.
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
    model: longContext ? "gpt-3.5-turbo-16k" : "gpt-3.5-turbo-0613",
    messages: messages,
    temperature: 0.5,
    top_p: 1,
    frequency_penalty: 0.5,
    // presence_penalty: 0,
    max_tokens: longContext ? 1500 : 1000,
    // functions: functions,
    // function_call: "auto",
    stream: true,
    n: 1,
    logit_bias: {  // remove botsplaining
      3062: -100, // important
      5296: -100, // note
      16365: -100, // understood
      4452: -100, // However
      374: -2, // is
      28993: -100, // Overall
      15592: -100, // AI
      12741: -100, // distinct
      88436: -100, // CONTEXT
      3619: -100, // understand
      71251: -100, // Understanding
      46551: -100, // Understanding
      15903: -100, // Further
      10555: -100, // noted
      26579: -100, // acknowledged
      1288: -100, // should
      2181: -20, // It
      28589: -100, // Overall
      12399: -100, // summary
    }
  };

  const stream = await OpenAIStream(payload);
  return appendToStreamAndRespond(
    stream,
    "\nSOURCE: " + contextText.replaceAll("SOURCE:", "")
  );
};

function appendToStreamAndRespond(
  inputStream: ReadableStream<any>,
  appendString: string
) {
  // Create a TransformStream that appends the string
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      console.log(chunk)
      // Pass through the original chunk without modification
      controller.enqueue(chunk);
    },
    flush(controller) {
      // Append the string once the input stream is done
      const encoder = new TextEncoder();
      const appendStringBuffer = encoder.encode(appendString);
      controller.enqueue(appendStringBuffer);
      controller.terminate();
    }
  });

  // Pipe the input stream through the TransformStream
  const outputStream = inputStream.pipeThrough(transformStream);

  // Pass the resulting stream to the Response object
  return new Response(outputStream);

  // Set the content type and status code if necessary
  // response.headers.set('Content-Type', 'text/plain');
  // response.status = 200;

  // // Don't forget to close the response
  // response.close();
}

export default handler;
