import { supabaseClient } from "@/lib/embeddings-supabase";
import * as cheerio from "cheerio";
import PromisePool from "es6-promise-pool";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import puppeteer, { Browser, Page } from "puppeteer";
import { Readable, ReadableOptions } from "stream";
import { uploadMetadata } from "./doistuffs";
import { cleaners } from "./sitespecific";

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
    this.push(messages.join(" ") + "\n");
  }
}

let stream: CustomReadableStream;

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method, body } = req;

    if (method !== "POST") {
    res.status(405).end();
    }
    let urls: string[] = body.urls.map((url: string) =>
      url.startsWith("10.") ? "https://doi.org/" + url : url
    );

    stream = new CustomReadableStream();
    main(stream, urls)
      .then(() => stream.push(null))
      .catch(() => stream.push(null));
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "no-cache");
    stream.pipe(res);

}


async function main(stream: CustomReadableStream, urls: string[]) {
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1600, height: 1200 }
  });

    urls = urls.map(normalizeUrl)


  const generator = function* () {
    for (const url of urls) yield runUrl(url, browser);
  };
   // @ts-ignore
  const pool = new PromisePool(generator(), 5);
  pool.addEventListener("rejected", (event) =>
    console.log("Rejected: " + String(event))
  );

  await pool.start();
  browser.close();
  stream.log("\nDone");
}

async function submit({ chunk, doi } : { chunk: string, doi: string }) {
  if (chunk.length < 100) {
    stream.log("skipping document with length < 100");
    return;
  }

  const input = chunk.replaceAll(/\n/g, " ");
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
      console.error("error in embeddingData: " + error, input);
      await new Promise((r) => setTimeout(r, 10000));
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

async function runUrl(url: string, browser: Browser) {
    let chunks: string[] = [];
    let doi: string = "";
    let attempt = 0;
    while (attempt < 4) {
      try {
          ({ chunks, doi }  = await run(browser, url))
        break;
      } catch (error) {
        // @ts-ignore
        if (error.message === "hostname not in goodClass") {
          stream.log("Unknown web", url, "\n");
          break;
        }
        stream.log("error in getDocuments: " + error);
        console.trace(error);
        attempt++;
      }
    }
    stream.log("Working");
    await Promise.all(chunks.map((chunk) => submit({ chunk, doi })));
}



async function gotoPage(page: Page, url: string) {
  console.log("fetching url: " + url);
  stream.log("Running", url, "\n");
  await page.goto(url, { waitUntil: "networkidle0", timeout: 10000 });
  console.log("network idle");
  const actualURL = page.url();
  let hostname = extractHostname(actualURL) as keyof typeof cleaners;
  if (!(hostname in cleaners)) {
    throw new Error("hostname not in goodClass");
  }
  return { actualURL, ...cleaners[hostname] };
}

async function run(browser: Browser, url: string) {
  let page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
  });
  let { actualURL, goodClass, toRemove, doiTag, runFunc, urlConverter } =
    await gotoPage(page, url);
  //  console.log(cheerio.load(await page.content()).text());

  if (urlConverter) {
    const newurl = urlConverter(actualURL);
    if (newurl !== url) {
      await page.close();
      page = await browser.newPage();
      ({ actualURL, goodClass, toRemove, doiTag, runFunc, urlConverter } =
        await gotoPage(page, newurl));
      console.log("new url: " + actualURL)
    }
  }

  await page.waitForSelector(goodClass.split(" ")[0], { timeout: 10000 });
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

    await supabaseClient.from("documents").delete().eq("doi", doi);

  if (runFunc) runFunc($);
  if (toRemove) $(toRemove).remove();

  let articleText = goodClass
    .split(" ")
    .map((el) => $(el).text())
    .join(" ")
    .replaceAll(/(e\.g\.)|(i\.e\.)/g, "such as")
    .replaceAll("Supplementary ", "")
    .replaceAll(/\(Box\s\d*\)/g, "")
    .replaceAll(/\((preprint: )?[\w\-]+ et al.*?\)/g, "")
    .replaceAll(/et al\.,?\s?/g, "")
    .replaceAll(/ref\.\s?/g, "")
    .replaceAll(
      /([Tt]able|Note(s?)|[Ff]igs?\.?|[Vv]ideo(s?)|Data)\s?([\w+\.,]( and)?)*/g,
      ""
    )
    .replaceAll(/Fig(ure )?/g, "")
    .replaceAll("for review see ", "")
    .replaceAll("review in", "")
    .replaceAll(/ Additional file :?\s?\w+(and )?/g, "")
    .replaceAll("(refs)", "")
    .replaceAll(/["“]Methods[”"]/g, "")
    .replaceAll("Extended", "")
    .replaceAll(/\s?\([\s\d]+\)/g, "")
    .replaceAll(/Figs?\. [S?\d\w]+/gi, "")
    .replaceAll(/\((\w?\s?and\s?\w?)+\)/g, "")
    .replaceAll(" ;", "")
    .replaceAll(/\([A-Z](,\s[A-Z])*\)/g, "")
    .replaceAll(/\(([,;\s]|and)+\)/g, "")
    .replaceAll(/\s?[\[\(][\s,;–\-,]*[\)\]]\s?/g, "")
    .replaceAll(/\s[,;]/g, "")
    .replaceAll(" (data not shown)", "")
    .replaceAll(/\s?\(Table \d+\w?\)/g, "")
    .replaceAll(/\s?\(ref\.\s\d+\)/g, "")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\.([A-Z])/g, ". $1")
    .replaceAll(/<[^>]*>/gm, "")
    .replaceAll(/\s+([,.])/g, "$1")
    .replaceAll(/\([;,\s\-]/g, "(")
    .replaceAll(/[;,\s\-]\)/g, ")")
    .replaceAll(/\([\s;,\-]*\)/g, "")
    .replaceAll(/,+/g, ",")
    .replaceAll(/[\s,]+\./g, ".")
    .replaceAll("\n", " ");

  const doiFile = doi.replaceAll(/\//g, "_");
  fs.writeFileSync("output/" + doiFile + ".txt", articleText);

  const metadata = await uploadMetadata(supabaseClient, doi);
    return { chunks: slice(metadata.title, articleText, 150), doi }
}

function countWords(str: string) {
  return str.split(" ").length;
}

// Slice the document by sentence into chunks of approximately 200 words
function slice(
  title: string,
  doc: string,
  chunkSize: number,
  overlap: number = 1
) {
    const out:  string[] = []
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

    // console.log("chunk", chunk, "\n");
    out.push( `${title}.${chunk}`);
    if (idx < sentences.length - overlap && lastCount < chunkSize) {
      idx -= overlap;
    }
  }
    return out;
}
