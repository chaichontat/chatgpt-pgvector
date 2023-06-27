import { SupabaseClient } from "@supabase/supabase-js";

// type Metadata = {
//   author: string;
//   year: Date;
//   title: string;
//   source_title: string;
//   source_id: string;
//   volume: string;
//   issue: string;
//   page: string;
//   doi: string;
//   reference: string;
//   citation: string;
//   citation_count: number;
//   oa_link: string;
// };

interface Authorship {
  author_position: "first" | "middle" | "last";
  author: {
    id: string;
    display_name: string;
    orcid: string | null;
  };
  institutions: {
    id: string | null;
    display_name: string;
    ror: string | null;
    country_code: string | null;
    type: "facility" | "education" | null;
  }[];
  is_corresponding: boolean;
  raw_affiliation_string: string;
  raw_affiliation_strings: string[];
}

interface Location {
  is_oa: boolean;
  landing_page_url: string;
  pdf_url: string | null;
  source: {
    id: string;
    display_name: string;
    issn_l: string | null;
    issn: string[] | null;
    is_oa: boolean;
    is_in_doaj: boolean;
    host_organization: string;
    host_organization_name: string;
    host_organization_lineage: string[];
    host_organization_lineage_names: string[];
    type: "journal" | "repository";
  };
  license: string | null;
  version: "publishedVersion" | null;
}

interface OAWorks {
  id: string;
  doi: string;
  title: string;
  display_name: string;
  publication_year: number;
  publication_date: string;
  ids: {
    openalex: string;
    doi: string;
    pmid: string;
  };
  language: string;
  primary_location: Location;
  type: "journal-article";
  open_access: {
    is_oa: boolean;
    oa_status: "bronze" | "gold" | "green";
    oa_url: string;
    any_repository_has_fulltext: boolean;
  };
  authorships: Authorship[];
  corresponding_author_ids: string[];
  corresponding_institution_ids: string[];
  apc_list: string[] | null;
  apc_paid: number | null;
  cited_by_count: number;
  biblio: {
    volume: number | null;
    issue: number | null;
    first_page: number | null;
    last_page: number | null;
  };
  is_retracted: boolean;
  is_paratext: boolean;
  concepts: {
    id: string;
    wikidata: string;
    display_name: string;
    level: 0 | 1 | 2 | 3;
    score: number;
  }[];
  mesh: string[];
  locations_count: number;
  locations: Location[];
  best_oa_location: Location;
  // ...
}

// async function getMetadata(doi: string) {
//     const resp = await fetch(`https://opencitations.net/index/coci/api/v1/metadata/${ doi }`)
//     return (await resp.json())[0] as Metadata;
// }

async function getMetadata(doi: string) {
  const resp = await fetch(
    `https://api.openalex.org/works/https://doi.org/${doi}`
  );
  return (await resp.json()) as OAWorks;
}

export async function uploadMetadata(
  supabaseClient: SupabaseClient,
  doi: string
) {
  const exists = await supabaseClient
    .from("citation")
    .select("*")
    .eq("doi", doi);
  if (exists.data?.length) {
    return exists.data[0];
  }

  await supabaseClient.from("citation").delete().eq("doi", doi);

  const metadata = await getMetadata(doi);

  let { error } = await supabaseClient.from("citation").insert({
    doi,
    title: metadata.title,
    first_author: metadata.authorships[0].author?.display_name
      .split(" ")
      .at(-1),
    last_author: metadata.authorships
      .at(-1)
      ?.author?.display_name.split(" ")
      .at(-1),
    year: metadata.publication_year,
    journal: metadata.primary_location?.source?.display_name
  });

  if (error) {
    console.error(error);
    throw error;
  }

  return metadata;
}
