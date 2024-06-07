import { supabaseClient } from "@/lib/embeddings-supabase";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";

import { Fetcher } from "openapi-typescript-fetch";

import { paths } from "./semanticscholar";

const fetcher = Fetcher.for<paths>();

fetcher.configure({
  baseUrl: "https://api.semanticscholar.org/graph/v1",
  init: {
    headers: {
      "Content-Type": "application/json"
    }
  }
});

const searchPapers = fetcher.path("/paper/search").method("get").create();

async function get(query: string, limit: number = 20, page: number = 1) {
  const currListPromise = supabaseClient.from("citation").select("doi");
  const respPromise = searchPapers({
    query,
    limit,
    offset: limit * (page - 1),
    fields:
      "title,abstract,authors,externalIds,journal,publicationDate,citationCount,tldr,publicationTypes"
  });
  const [currList, resp] = await Promise.all([
    currListPromise,
    respPromise.then((r) => r.data)
  ]);
  const curr = new Set(
    currList.data!.map((d) => (d.doi as string).toLowerCase())
  );
  return resp.data!.filter(
    (d) =>
      d.journal &&
      d.externalIds!.DOI &&
      !curr.has((d.externalIds!.DOI as string).toLowerCase())
  );
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { body } = req;
  const { query, limit, page } = body;
  const resp = await get(query, limit, page);
  const out = resp.map((r) => ({
    title: r.title!,
    journal: r.journal!.name,
    citations: r.citationCount!,
    doi: r.externalIds!.DOI,
    abstract: r.abstract!,
    data: r.publicationDate!,
    authors: r.authors?.[0].name.split(" ").at(-1)
  }));

  return res.status(200).json(out);
}
