import * as cheerio from "cheerio";
import { log } from "console";

type Cleaner = {
  goodClass: string;
  toRemove: string;
  doiTag: string;
  runFunc?: ($: cheerio.CheerioAPI) => void;
};

function genAvoidSelection(names: string[], tag: string) {
  return names.map((name) => `section[${ tag }="${ name }"]`).join(", ");
}

export const cleaners: Record<string, Cleaner> = {
  nature: {
    goodClass: ".main-content section[data-title=Abstract]",
    toRemove:
      'a:not([href*="Glos"]), h2, h3, h4, sup, .c-article-table, .c-article-section__figure, section[data-title*="ethods"], .c-article-box__button-text, .c-article-box',
    doiTag: "meta[name=citation_doi]"
  },
  sciencedirect: {
    goodClass: ".Body",
    toRemove:
      'a:not([href*="topic"]), h1, h2, h3, h4, figure, [id^=ack], .Appendices, [name^=bbib], .article-textbox, .tables, [class*="navigation"], .list',
    doiTag: "meta[name=citation_doi]",
    runFunc: sciencedirectCleaner
  },
  nih: {
    goodClass: ".sec",
    toRemove: "[id^=fn], [id^=ref], [id^=ack], .fig, a",
    doiTag: "meta[name=citation_doi]"
  },
  science: {
    goodClass: "#abstracts #bodymatter",
    toRemove: '.figure-wrap, section[role="doc-acknowledgments"], a, section[data-type*="ethod"]',
    doiTag: "meta[name=dc.Identifier][scheme=doi]"
  },
  pnas: {
    goodClass: "#abstracts #bodymatter",
    toRemove: ".figure-wrap, a, #glossary, data-type[methods]",
    doiTag: "meta[name=dc.Identifier][scheme=doi]"
  },
  biomedcentral: {
    goodClass: "article",
    toRemove:
      ".c-article-header, h2, a, figure, #MagazineFulltextArticleBodySuffix, " +
      genAvoidSelection(
        [
          "Methods",
          "Materials and methods",
          "Availability of data and materials",
          "Acknowledgements",
          "Acknowledgments",
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
    doiTag: "meta[name=citation_doi]"
  },
  jneurosci: {
    goodClass: ".article",
    toRemove:
      'a, div.section:has(h2:contains("Materials and Methods")), .kwd-group, h2, h3, a, .materials-methods, .fn-group, .license, .ref-list',
    doiTag: "meta[name=DC.Identifier]",
  },
  frontiersin: {
    goodClass: ".article-section",
    toRemove:
      'a, h1, h2:contains("Acknowledg") + p, h2:contains("onflict") + p, h2:contains("Funding") + p, h2:contains("ontribution") + p, h2:contains("Publisher") + p, h2, .Imageheaders, .FigureDesc, .References, .authors, .notes, .clear, .AbstractSummary, script, .article-header-container',
    doiTag: "meta[name=citation_doi]"
  },
  elifesciences: {
    goodClass: ".main-content-grid",
    toRemove:
      "a, h1, h2, h3, h4, .article-section--highlighted .asset-viewer-inline, [id=data], [id=references], [id^=sa], [id=info], [id=metrics], [id^=fig], .speech-bubble, button, article-meta",
    doiTag: "meta[name=dc.identifier]",
    runFunc: elifeCleaner
  },
  cell: {
    goodClass: ".container",
    toRemove:
      'a, h2, .floatDisplay, .reference-citations, .refs, .article-info, figure, figcaption, style, .left-side-nav, .figure-viewer',
    doiTag: "meta[name=citation_doi]",
    runFunc: cellCleaner
  }
} as const;

function sciencedirectCleaner($: cheerio.CheerioAPI) {
  const toRemove = [
    "ethods", "References", "Conflict", "contact", "cknowledg", "Supplementary", "Supplemental", "Experimental", "author", "Declaration", "Related", "vailability", "Contributions"
  ]
  $("section").each((i, elem) => {
    if (
      $(elem).has(
        toRemove.map((x) => `h2:contains("${ x }")`).join(", ")
      ).length ||
      $(elem).has(
        toRemove.map((x) => `h3:contains("${ x }")`).join(", ")
      ).length ||
      $(elem).has(
        toRemove.map((x) => `h4:contains("${ x }")`).join(", ")
      ).length
    ) {
      $(elem).remove();
    }
  });
}

function genCell(name: string) {
  return `h2[data-left-hand-nav="${ name }"]`;
}

function cellCleaner($: cheerio.CheerioAPI) {
  $("section").each((i, elem) => {
    if (
      $(elem).has(
        [
          "Acknowledgments",
          "Acknowledgements",
          "Supplementary information",
          "Supplementary data",
          "Supplemental Information",
          "Graphical Abstract",
          "Experimental Procedures",
          "Author Contributions",
          "Declaration of Interests",
          "Figures",
          "Article info",
          "Related Articles",
          "Accession Numbers"
        ]
          .map(genCell)
          .join(", ") + ', figures, section > h2:contains("Figure")'
      ).length
    ) {
      $(elem).remove();
    }
  });
}

function _genElife($: cheerio.CheerioAPI, elem: cheerio.Element, name: string) {
  if ($(elem).has("header").has("a").has(`h2:contains("${ name }")`).length) {
    log("removing " + name);
    $(elem).remove();
    return true;
  }
  return false;
}

function elifeCleaner($: cheerio.CheerioAPI) {
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
