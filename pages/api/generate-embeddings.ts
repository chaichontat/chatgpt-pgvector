import { supabaseClient } from "@/lib/embeddings-supabase";
import * as cheerio from "cheerio";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import puppeteer, { Browser } from "puppeteer";
import { Readable, ReadableOptions } from "stream";
import { uploadMetadata } from "./doistuffs";
import { cleaners } from "./sitespecific";
// embedding doc sizes

let browserPromise = puppeteer.launch({ headless: "new" });
const apiKey = process.env.OPENAI_API_KEY;

const apiURL =
  process.env.OPENAI_PROXY == ""
    ? "https://api.openai.com"
    : process.env.OPENAI_PROXY;

type Docs = { doi: string; body: string }[];

class CustomReadableStream extends Readable {
  private counter: number;

  constructor(options: ReadableOptions = {}) {
    super(options);
    this.counter = 0;
  }

  _read() {
    // Do nothing here
  }

  log(...messages: string[]) {
    this.counter++;
    this.push(messages.join(" "));
  }
}

let stream: CustomReadableStream;

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method, body } = req;

  if (method === "POST") {
    let urls: string[] = body.urls.map((url: string) =>
      url.startsWith("10.") ? "https://doi.org/" + url : url
    );

    stream = new CustomReadableStream();
    // readableStream.push("Hello, ");
    // readableStream.pause();

    // const promises = [];
    main(stream, urls)
      .then(() => stream.push(null))
      .catch(() => stream.push(null));

    // // const readStream = new ReadableStream({
    // //   start(controller) {
    // // Append some data to the stream
    // // set new text every 100ms for 3 seconds
    // for (let i = 0; i < 10; i++) {
    //   promises.push(
    //     setTimeout(() => {
    //       readableStream.push("Hello, ");
    //       readableStream.push("world!");
    //     }, i * 100)
    //   );
    // }
    // Promise.all(promises).then(() => readableStream.push(null));

    //     // Close the stream after all promises are resolved
    //     Promise.all(promises).then(() => controller.close());
    //   }
    // });
    //   return new Response(readStream, {
    //   status: 200,
    //   headers: {
    //     "content-type": "text/plain",
    //     "Cache-Control": "no-cache",
    //   },
    // });

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "no-cache");
    stream.pipe(res);

    // return res.status(200).json({ success: true });
  }
}

async function submit({ body, doi }: { body: string; doi: string }) {
  if (body.length < 100) {
    stream.log("skipping document with length < 100");
    return;
  }

  const input = body.replaceAll(/\n/g, " ");

  console.log("\nDocument length: \n", body.length);
  console.log("\nURL: \n", doi);
  let embedding: string = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const embeddingResponse = await fetch(apiURL + "/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input,
        model: "text-embedding-ada-002"
      })
    });
    // console.log("\nembeddingResponse: \n", embeddingResponse);
    const embeddingData = await embeddingResponse.json();

    try {
      [{ embedding }] = embeddingData.data;
    } catch (error) {
      stream.log("error in embeddingData: " + error);
      console.error("error in embeddingData: " + error);
      await new Promise((r) => setTimeout(r, 30000));
      continue;
    } finally {
      break;
    }
  }

  if (embedding) {
    try {
      await supabaseClient.from("documents").insert({
        content: input,
        embedding,
        doi
      });
    } catch (error) {
      stream.log("error in supabase insert: " + error);
      console.error("error in supabase insert: " + error);
    }
  }
  stream.log(".");
}

async function main(stream: CustomReadableStream, urls: string[]) {
  const documents = await getDocuments(urls);
  console.log("sending documents");
  // Reset related to DOI.
  if (documents) {
    await supabaseClient.from("documents").delete().eq("doi", documents[0].doi);
  }

  stream.log("Working");

  await Promise.all(documents.map(submit));
  stream.log("\nDone");
}

function extractHostname(url: string) {
  const domain = new URL(url).hostname;
  const topLevelDomain = domain.split(".").slice(-2)[0];
  return topLevelDomain;
}

function normalizeUrl(url: string) {
  // Remove trailing slashes
  url = url.replaceAll(/\/+$/g, "");

  // Remove section navigators
  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    url = url.substring(0, hashIndex);
  }
  const queryIndex = url.indexOf("?");
  if (queryIndex !== -1) {
    url = url.substring(0, queryIndex);
  }

  return url;
}

async function getDocuments(urls: string[]) {
  const documents: Docs = [];

  urls = urls.map(normalizeUrl);
  // let res = await supabaseClient.from("unique_doi").select("doi");
  // let existingurls = res.data?.map((row) => row.doi);
  const browser = await browserPromise;

  for (const url of urls) {
    let attempt = 0;
    while (attempt < 3) {
      try {
        await run(documents, browser, url);
        break;
      } catch (error) {
        // @ts-ignore
        if (error.message === "hostname not in goodClass") {
          stream.log("Unknown web", url, "\n");
          break;
        }
        stream.log("error in getDocuments: " + error);
        console.trace(error)
        attempt++;
      }
    }
  }
  console.log(documents.length);
  return documents;
}

function convertCell(url: string) {
  const match = url.match(
    /^https:\/\/www\.cell\.com\/[a-z\-]+\/fulltext\/(S.+)$/i
  );
  if (match) {
    return `https://www.sciencedirect.com/science/article/pii/${match[1].replace(
      /\W+/g,
      ""
    )}`;
  }
  throw new Error("This is not a valid Cell Press URL.");
}

async function run(documents: Docs, browser: Browser, url: string) {
  if (extractHostname(url) === "cell") {
    url = convertCell(url);
  }
  let fetchURL = url.replace("/abs/", "/full/").replaceAll(".short", ".full");
  console.log("fetching url: " + fetchURL);
  stream.log("Running", fetchURL, "\n");

  const page = await browser.newPage();
  await page.goto(fetchURL, { waitUntil: "networkidle0" });
  const actualURL = page.url();
  const hostname = extractHostname(actualURL) as keyof typeof cleaners;
  if (!(hostname in cleaners)) {
    throw new Error("hostname not in goodClass");
  }
  console.log(hostname);

  const { goodClass, doiTag, toRemove, runFunc } = cleaners[hostname];

  await page.waitForSelector(goodClass.split(" ")[0]);
  const html = await page.content();
  await page.close();

  const $ = cheerio.load(html);
  let doi = $(doiTag).attr("content");
  {
    if (!doi) {
      throw new Error("No DOI found");
    }

    if (doi.startsWith("doi:")) {
      doi = doi.substring(4);
    }
  }

  if (runFunc) runFunc($);
  if (toRemove) $(toRemove).remove();

  const articleText = goodClass
    .split(" ")
    .map((el) => $(el).text())
    .join(" ")
    .replaceAll(/(e\.g\.)|(i\.e\.)/g, "such as")
    .replaceAll("Supplementary ", "")
    .replaceAll(/\(Box\s\d*\)/g, "")
    .replaceAll(/et al\.,?\s?/g, "")
    .replaceAll(/ref\.\s?/g, "")
    .replaceAll("Figure ", "")
    .replaceAll("for review see ", "")
    .replaceAll("review in", "")
    .replaceAll(/ Additional file :?\s?\w+(and )?/g, "")
    .replaceAll("(refs)", "")
    .replaceAll(/["“]Methods[”"]/g, "")
    .replaceAll("Extended", "")
    .replaceAll(/([Tt]able|Note(s?)|[Ff]igs?\.|[Vv]ideo(s?)|Data)\s?([\w+\.,]( and)?)*/g, "")
    .replaceAll(/\s?\([\s\d]+\)/g, "")
    .replaceAll(/[A-Z] (to|and) [A-Z]/g, "")
    .replaceAll(/Figs?\. [S?\d\w]+/gi, "")
    .replaceAll(/\((\s?and\s?)+\)/g, "")
    .replaceAll(" ;", "")
    .replaceAll(/\([A-Z](,\s[A-Z])*\)/g, "")
    .replaceAll(/\(([,;\s]|and)+\)/g, "")
    .replaceAll(/\s?[\[\(][\s,;–\-,]*[\)\]]\s?/g, "")
    .replaceAll(" (data not shown)", "")
    .replaceAll(/\s?\(Table \d+\w?\)/g, "")
    .replaceAll(/\s?\(ref\.\s\d+\)/g, "")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\.([A-Z])/g, ". $1")
    .replaceAll(/<[^>]*>/gm, "")
    .replaceAll(/\s+([,.])/g, "$1")
    .replaceAll(/\([;,\s\-]/g, "(")
    .replaceAll(/[;,\s\-]\)/g, ")")
    .replaceAll(/,+/g, ",")
    .replaceAll(",.", ".")
    .replaceAll("\n", " ");

  const doiFile = doi.replaceAll(/\//g, "_");
  fs.writeFileSync("output/" + doiFile + ".txt", articleText);

  // const dois = await supabaseClient.from("unique_doi").select("*")

  // for ({ doi } of dois.data) {
  //   console.log("doi: " + doi)
  //   await uploadMetadata(supabaseClient, doi);
  // }

  const metadata = await uploadMetadata(supabaseClient, doi);
  return slice(documents, doi, metadata.title, articleText, 150);
}

function countWords(str: string) {
  return str.split(" ").length;
}

// Slice the document by sentence into chunks of approximately 200 words
function slice(
  documents: { doi: string; body: string }[],
  doi: string,
  title: string,
  doc: string,
  chunkSize: number,
  overlap: number = 1
) {
  const sentences = doc.replaceAll(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");
  let idx = 0;

  while (idx < sentences.length) {
    let chunk = "";
    let wordCount = 0;
    let lastCount = 0;
    while (wordCount < chunkSize && idx < sentences.length) {
      const sentence = sentences[idx].trim();
      lastCount = countWords(sentence);
      wordCount += lastCount;
      chunk += " " + sentence;
      idx++;
    }

    console.log("chunk", chunk, "\n");
    documents.push({ doi, body: `${title}.${chunk}` });
    if (idx < sentences.length - overlap && lastCount < chunkSize) {
      idx -= overlap;
    }
  }
  return documents;
}
