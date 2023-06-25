import * as cheerio from "cheerio";
import { log } from "console";

export function sciencedirectCleaner($: cheerio.CheerioAPI) {
  $("section").each((i, elem) => {
    if (
      $(elem).has(
        'h2:contains("Methods"), h2:contains("References"), h2:contains("Conflict of interest")'
      ).length
    ) {
      $(elem).remove();
    }
  });
}

function genCell(name: string) {
  return `h2[data-left-hand-nav="${name}"]`;
}

export function cellCleaner($: cheerio.CheerioAPI) {
  $("section").each((i, elem) => {
    if (
      $(elem).has(
        [
          "Acknowledgments",
          "Supplementary information",
          "Experimental Procedures",
          "Related Articles"
        ]
          .map(genCell)
          .join(", ") + " #figures"
      ).length
    ) {
      $(elem).remove();
    }
  });
}

function _genElife($: cheerio.CheerioAPI, elem: cheerio.Element, name: string) {
  if ($(elem).has("header").has("a").has(`h2:contains("${name}")`).length) {
    log("removing " + name);
    $(elem).remove();
    return true;
  }
  return false;
}

export function elifeCleaner($: cheerio.CheerioAPI) {
  const names = [
    "Materials and methods",
    "Data availability",
    "References",
    "Decision letter",
    "Author response",
    "Article and author information"
  ];

  $("section").each((i, elem) => {
    names.map((name) => _genElife($, elem, name));
  });
}
