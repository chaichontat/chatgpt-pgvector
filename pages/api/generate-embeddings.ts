import { supabaseClient } from "@/lib/embeddings-supabase";
import * as cheerio from "cheerio";
import { log } from "console";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import puppeteer, { Browser } from "puppeteer";
// embedding doc sizes
const docSize: number = 100;

let browserPromise = puppeteer.launch({ headless: "new" });

type Docs = { doi: string; body: string }[];

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method, body } = req;

  if (method === "POST") {
    const { urls } = body;
    const documents = await getDocuments(urls);
    console.log("sending documents");
    const apiKey = process.env.OPENAI_API_KEY;

    const apiURL =
      process.env.OPENAI_PROXY == ""
        ? "https://api.openai.com"
        : process.env.OPENAI_PROXY;

    for (const { body, doi } of documents) {
      if (body.length < 100) {
        console.log("skipping document with length < 100");
        continue;
      }

      const input = body.replace(/\n/g, " ");

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
          console.error("error in embeddingData: " + error);
          continue;
        } finally {
          break;
        }
      }

      if (embedding) {
        try {
          await supabaseClient.from("documents").delete().eq("doi", doi);
          await supabaseClient.from("documents").insert({
            content: input,
            embedding,
            doi
          });
        } catch (error) {
          console.error("error in supabase insert: " + error);
        }
      }
    }
    return res.status(200).json({ success: true });
  }
}

function extractHostname(url: string) {
  const domain = new URL(url).hostname;
  const topLevelDomain = domain.split(".").slice(-2)[0];
  return topLevelDomain;
}

const goodClass = {
  nature: ".main-content",
  sciencedirect: ".Body",
  nih: ".sec",
  science: "#abstracts #bodymatter",
  pnas: "#abstracts #bodymatter",
  biomedcentral: "article",
  jneurosci: ".article",
  frontiersin: ".article-section"
  // elifesciences: ".main-content-grid"
};

type PageCleaner = Record<keyof typeof goodClass, string>;

function genAvoidSelection(names: string[], tag: string) {
  return names.map((name) => `section[${tag}="${name}"]`).join(", ");
}

const toRemove: PageCleaner = {
  nih: "[id^=fn], [id^=ref], .fig, a",
  nature: 'h2, sup, .c-article-section__figure, [data-title="Methods"]',
  sciencedirect: "figure, [id^=ack], .Appendices, [name^=bbib]",
  science: '.figure-wrap, section[role="doc-acknowledgments"], a',
  pnas: ".figure-wrap, a",
  biomedcentral:
    ".c-article-header, h2, a, figure, #MagazineFulltextArticleBodySuffix, " +
    genAvoidSelection(
      [
        "Methods",
        "Materials and methods",
        "Availability of data and materials",
        "Acknowledgements",
        "Funding",
        "Author information",
        "Ethics declarations",
        "Additional information",
        "Supplementary information",
        "Rights and permissions",
        "About this article",
        "Change history"
      ],
      "data-title"
    ),
  jneurosci:
    ".kwd-group, h2, h3, a, .materials-methods, .fn-group, .license, .ref-list",
  frontiersin: "a, h2, .Imageheaders, .FigureDesc, .References"
  // elifesciences: "h2, h3, a, .article-section--highlighted .asset-viewer-inline"
};

const doiTag: PageCleaner = {
  nature: "meta[name=citation_doi]",
  nih: "meta[name=citation_doi]",
  sciencedirect: "meta[name=citation_doi]",
  science: "meta[name=dc.Identifier][scheme=doi]",
  pnas: "meta[name=dc.Identifier][scheme=doi]",
  biomedcentral: "meta[name=citation_doi]",
  jneurosci: "meta[name=DC.Identifier]",
  frontiersin: "meta[name=citation_doi]"
};

function normalizeUrl(url: string) {
  // Remove trailing slashes
  url = url.replace(/\/+$/, "");

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
        console.error("error in getDocuments: " + error);
        attempt++;
      }
    }
  }
  return documents;
}

async function run(documents: Docs, browser: Browser, url: string) {
  let fetchURL = url;
  console.log("fetching url: " + fetchURL);

  const page = await browser.newPage();
  await page.goto(fetchURL, { waitUntil: "networkidle0" });
  const actualURL = page.url();
  const hostname = extractHostname(actualURL) as keyof typeof goodClass;
  if (!(hostname in goodClass)) {
    throw new Error("hostname not in goodClass");
  }
  console.log(hostname);

  await page.waitForSelector(goodClass[hostname].split(" ")[0]);
  const html = await page.content();
  await page.close();

  const $ = cheerio.load(html);
  const doi = $(doiTag[hostname]).attr("content");

  if (!doi) {
    throw new Error("No DOI found");
  }

  if (toRemove[hostname]) $(toRemove[hostname]).remove();

  const articleText = goodClass[hostname]
    .split(" ")
    .map((el) => $(el).text())
    .join(" ")
    .replace(/\.(A-Z)/g, ". $1")
    .replace(/ \(([;,]\s)*\)/g, "")
    .replace(/\[(,\s?)*\]\s?/g, "")
    .replace(/\s[\.,]\s/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\[[\s,;–-]*\]/g, "")
    .replace(/\([\s,;–-]*\)/g, "")
    .replace(/\(Fig. \w+\)/g, "");

  const doiFile = doi.replace(/\//g, "_");
  fs.writeFileSync("output/" + doiFile + ".html", html);
  fs.writeFileSync("output/" + doiFile + ".txt", articleText);

  slice(documents, doi, articleText, 100);
}

function slice(
  documents: { doi: string; body: string }[],
  doi: string,
  doc: string,
  docSize: number,
  overlap: number = 20
) {
  let start = 0;
  const words = doc.split(" ");
  while (start < words.length) {
    const end = start + docSize;
    const chunk = words.slice(start, end).join(" ");
    documents.push({ doi, body: chunk });
    start = end - overlap;
  }
}
