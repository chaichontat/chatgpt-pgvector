import * as cheerio from "cheerio";
import { log } from "console";

type Cleaner = {
  goodClass: string;
  toRemove: string;
  doiTag: string;
  runFunc?: ($: cheerio.CheerioAPI) => void;
};

function genAvoidSelection(names: string[], tag: string) {
  return names.map((name) => `section[${tag}*="${name}"]`).join(", ");
}

const junkWords = [
  "ethods",
  "References",
  "Conflict",
  "contact",
  "cknowledg",
  "Supplementary",
  "Supplemental",
  "Experimental",
  "Funding",
  "nterest",
  "author",
  "eclaration",
  "Related",
  "vailability",
  "ontributions",
  "bbreviation",
  "Publisher",
  "tatement",
  "slides",
  "lossary",
  "ermissions",
  "About"
];

export const cleaners: Record<string, Cleaner> = {
  nature: {
    goodClass: ".main-content section[data-title=Abstract]",
    toRemove:
      'a:not([href*="Glos"]), h2, h3, h4, sup, .c-article-table, .c-article-section__figure, section[data-title*="ethods"], .c-article-box__button-text, .c-article-box',
    doiTag: "meta[name=citation_doi]"
  },
  sciencedirect: {
    goodClass: ".abstract.author .Body",
    toRemove:
      'a:not([href*="topic"]), h1, h2, h3, h4, figure, [id^=ack], .Appendices, [name^=bbib], .article-textbox, .tables, [class*="navigation"], .list, .display',
    doiTag: "meta[name=citation_doi]",
    runFunc: sciencedirectCleaner
  },
  nih: {
    goodClass: ".sec",
    toRemove:
      '[id^=fn], [id^=ref], [id^=ack], [id^=app], [id^=note], [id^=funding], [id^=B], .fig, a, .table-wrap, .sec:has(h2:contains("cknowled")), .sec:has(h2:contains("ETHODS")), .sec:has(h2:contains("ppendi")), h1, h2, h3, h4',
    doiTag: "meta[name=citation_doi]"
  },
  science: {
    goodClass: "#abstracts #bodymatter",
    toRemove:
      'aside, .figure-wrap, section[role="doc-acknowledgments"], a, h1, h2, h3, h4, section[data-type*="ethod"]',
    doiTag: "meta[name=dc.Identifier][scheme=doi]"
  },
  pnas: {
    goodClass: "#abstracts #bodymatter",
    toRemove:
      ".signup-alert-ad, .figure-wrap, a, #glossary, #backmatter, #footnotes, section[data-type*=ethods], h1, h2, h3",
    doiTag: "meta[name=dc.Identifier][scheme=doi]"
    // runFunc: ($: cheerio.CheerioAPI) => {
    //   $("section").each((i, elem) => {
    //     if (
    //       $(elem).has(
    //         toRemove.map((x) => `h2:contains("${ x }")`).join(", ")
    //       ).length
    //     ) {
    //       $(elem).remove();
    //     }
    //   })
    // }

    // section:has(h2:contains("rocedures")), section:has(h2:contains("ethods")),
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
          "unding",
          "declarations",
          "information",
          "Rights",
          "About",
          "history",
          "bbreviations",
          "Additional"
        ],
        "data-title"
      ),
    doiTag: "meta[name=citation_doi]"
  },
  jneurosci: {
    goodClass: ".article",
    toRemove:
      'a, div.section:has(h2:contains("Materials and Methods")), .kwd-group, h2, h3, a, .materials-methods, .fn-group, .license, .ref-list, .fig',
    doiTag: "meta[name=DC.Identifier]"
  },
  frontiersin: {
    goodClass: ".article-section",
    toRemove:
      junkWords.map((x) => `h2:contains("${x}") + p`).join(", ") +
      ' , a, h1, div + .referenceslink, h1, h2, h3, h4, .Imageheaders, .FigureDesc, .References, .authors, .notes, .clear, .AbstractSummary, script, .article-header-container, [name^=B], .AbstractSummary, [class^="meta"], p:contains("conflicts of interest")',
    doiTag: "meta[name=citation_doi]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $("div").each((i, elem) => {
        if ($(elem).siblings(".referenceslink").length) {
          $(elem).remove();
        }
      });
    }
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
      "a, h2, .floatDisplay, .reference-citations, .refs, .article-info, figure, figcaption, style, .left-side-nav, .figure-viewer, [id~=app]",
    doiTag: "meta[name=citation_doi]",
    runFunc: cellCleaner
  },
  oup: {
    goodClass: 'div[data-widgetname="ArticleFulltext"]',
    toRemove:
      "[class*=meta], a, h1, h2, h3, h4, .ref-list, .authorNotes-section-title, .footnote, .copyright, .license, .fig, [class^=table]",
    doiTag: "meta[name=citation_doi]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $(".section-title").each((i, elem) => {
        if (
          !$(elem)
            .text()
            .match(
              /(methods|materials|contributions|supplement|funding|conflict|statement|copyright|publisher|license|notes|availabilit|declar|acknowl)/i
            )
        ) {
          return;
        }

        const next = $(elem).nextAll();
        const junk = [];
        while (next.length) {
          const nextElem = next.first();
          if (nextElem.is("h2")) {
            break;
          }
          junk.push(nextElem);
          next.splice(0, 1);
        }
        junk.forEach((x) => x.remove());
      });

      $(".chapter-para").each((i, elem) => {
        const prev = $(elem).prev();
        if (prev.is('h2[class^="back"]')) {
          $(elem).remove();
        }
      });
    }
  },
  cshlp: {
    goodClass: ".article",
    toRemove:
      "a, ul, [class^=kwd], .fig, .contributors, [class*=ethods], .ack, .fn-group, .copyright-statement, .license, .ref-list, .section-nav, h1, h2, h3, h4",
    doiTag: "meta[name=DC.Identifier]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $(".section").each((i, elem) => {
        if ($(elem).has('h2:contains("ethods")').length) {
          $(elem).remove();
        }
      });
    }
  },
  annualreviews: {
    goodClass: ".article-content",
    toRemove:
      '[class*=word], .article-tools, .figure-container, script, [class*=equation], sup, .formulaLabel, .ack, .lit-cited, .ar-modal, .mfp-hide, a:not([href*=dl]), h1, h2, h3, h4, p:contains("received funding"), p:contains("affiliation"), p:contains("cofounder"), p:contains("consultant")',
    doiTag: "meta[name=dc.Identifier]"
  }
} as const;

function sciencedirectCleaner($: cheerio.CheerioAPI) {
  $("section").each((i, elem) => {
    if (
      $(elem).has(junkWords.map((x) => `h2:contains("${x}")`).join(", "))
        .length ||
      $(elem).has(junkWords.map((x) => `h3:contains("${x}")`).join(", "))
        .length ||
      $(elem).has(junkWords.map((x) => `h4:contains("${x}")`).join(", ")).length
    ) {
      $(elem).remove();
    }
  });
}

function genCell(name: string) {
  return `h2[data-left-hand-nav="${name}"]`;
}

function cellCleaner($: cheerio.CheerioAPI) {
  $("section").each((i, elem) => {
    if (
      $(elem).has(
        [
          "Acknowledgments",
          "Acknowledgements",
          "information",
          "Supplementary data",
          "Supplement",
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
  if ($(elem).has("header").has("a").has(`h2:contains("${name}")`).length) {
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
