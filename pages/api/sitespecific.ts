import * as cheerio from "cheerio";
import { log } from "console";

type Cleaner = {
  goodClass: string;
  toRemove: string;
  doiTag: string;
  runFunc?: ($: cheerio.CheerioAPI) => void;
  urlConverter?: (url: string) => string;
};

function genAvoidSelection(names: string[], tag: string) {
  return names.map((name) => `section[${tag}*="${name}"]`).join(", ");
}

const junkWords = [
  "Methods",
  "References",
  "Conflict",
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
  "Author contributions",
  "Author Contributions",
  "bbreviation",
  "Publisher",
  "tatement",
  "slides",
  "lossary",
  "ermissions",
  "About",
  "nterests",
  "nformation",
  "ompliance",
  "thical",
  "appendi",
  "statement",
  "sponsorship",
  "version",
  "summary",
  "peer review"
];

const junkRegex = new RegExp(junkWords.join("|"), "gi");

export const cleaners: Record<string, Cleaner> = {
  nature: {
    goodClass: ".main-content section[data-title=Abstract]",
    toRemove:
      'a:not([href*="Glos"]), h2, h3, h4, sup, .c-article-table, .c-article-section__figure, section[data-title*="ethods"], .c-article-box__button-text, .c-article-box',
    doiTag: "meta[name*=doi]"
  },
  sciencedirect: {
    goodClass: ".Body #abstracts",
    toRemove:
      'a:not([href*="topic"]), h1, h2, h3, h4, figure, [id^=ack], .Appendices, [name^=bbib], .article-textbox, .tables, [class*="navigation"], .list, .display',
    doiTag: "meta[name=citation_doi]",
    runFunc: sciencedirectCleaner
  },
  nih: {
    // ncbi
    goodClass: ".sec",
    toRemove:
      "[id^=fn], [id^=ref], [id^=ack], [id^=app], [id^=note], [id^=funding], [id^=B], [id^=glos], .fig, a, .table-wrap, h1, h2, h3, h4",
    doiTag: "meta[name=citation_doi]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $(".sec").each((i, elem) => {
        if ($(elem).children("h2, h3").text().match(junkRegex)) {
          $(elem).remove();
        }
      });
    }
  },
  science: {
    goodClass: "#bodymatter #abstracts",
    toRemove:
      'aside, .figure-wrap, section[role="doc-acknowledgments"], a, h1, h2, h3, h4, section[data-type*="ethod"]',
    doiTag: "meta[name=dc.Identifier][scheme=doi]"
  },
  pnas: {
    goodClass: "#abstracts #bodymatter",
    toRemove:
      ".signup-alert-ad, .figure-wrap, a, #glossary, #backmatter, #footnotes, section[data-type*=ethods], h1, h2, h3",
    doiTag: "meta[name=dc.Identifier][scheme=doi]",
    urlConverter: (url: string) => url.replace("/abs", "/full")
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
    runFunc: cellCleaner,
    urlConverter: (url: string) => {
      const match = url.match(
        /^https:\/\/www\.cell\.com\/[a-z\-/]+\/(fulltext|pdf|abs)\/(S.+)(\.pdf)?$/i
      );
      if (match) {
        return `https://www.sciencedirect.com/science/article/pii/${match[2].replace(
          /\W+/g,
          ""
        )}`;
      }
      throw new Error("This is not a valid Cell Press URL.");
    }
  },
  oup: {
    goodClass: 'div[data-widgetname="ArticleFulltext"]',
    toRemove:
      "[class*=meta], a, h1, h2, h3, h4, .ref-list, .authorNotes-section-title, .footnote, .copyright, .license, .fig, [class^=table], p:contains(approved), p:contains(grateful), p:contains(grant)",
    doiTag: "meta[name=citation_doi]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $(".section-title").each((i, elem) => {
        if (!$(elem).text().match(junkRegex)) {
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
    },
    urlConverter: (url: string) => (url.endsWith(".full") ? url : url + ".full")
  },
  annualreviews: {
    goodClass: ".article-content",
    toRemove:
      '[class*=word], .article-tools, .figure-container, script, [class*=equation], sup, .formulaLabel, .ack, .lit-cited, .ar-modal, .mfp-hide, a:not([href*=dl]), h1, h2, h3, h4, p:contains("received funding"), p:contains("affiliation"), p:contains("cofounder"), p:contains("consultant")',
    doiTag: "meta[name=dc.Identifier]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $("p").each((i, elem) => {
        const prev = $(elem).prev();
        if (prev.is("h2") && prev.text().match(junkRegex)) {
          $(elem).remove();
        }
      });
    },
    urlConverter: (url: string) => {
      const match = url.match(/^(.*annualreviews\.org\/doi\/)(abs\/)?(.*)$/i);
      if (!match) throw new Error("This is not a valid Annual Reviews URL.");
      return url.match("full") ? url : match[1] + "full/" + match[3];
    }
  },

  physiology: {
    goodClass: ".hlFld-Abstract .hlFld-Fulltext",
    toRemove: "figure, .ack, .tableToggle, .figure-extra, a, h1, h2, h3, h4",
    doiTag: "meta[name=dc.Identifier]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $("[class^=sec]").each((i, elem) => {
        if (
          $(elem).has(junkWords.map((x) => `h1:contains("${x}")`).join(", "))
            .length
        ) {
          $(elem).remove();
        }
      });
    }
  },
  embopress: {
    goodClass: ".article__body",
    toRemove: "#reference, [class*=supporting], figure, a, h1, h2, h3, h4",
    doiTag: "meta[name=dc.identifier]",
    runFunc: ($: cheerio.CheerioAPI) => {
      $(".article-section__content").each((i, elem) => {
        if (
          $(elem).has(junkWords.map((x) => `h2:contains("${x}")`).join(", "))
            .length
        ) {
          $(elem).remove();
        }
      });
    }
  },
  springer: {
    goodClass: '[data-title="Abstract"] .main-content',
    toRemove:
      ".c-article__sub-heading, .c-article-subject-list, [data-test=chapter-cobranding-and-download], figure, a, h1, h2, h3, h4",
    doiTag: "meta[name=citation_doi]"
  },
  wiley: {
    goodClass: ".article__body",
    toRemove: "figure, a, h1, h2, h3, h4, .feature, .accordion, .cited-by",
    doiTag: "meta[name=dc.identifier]"
  }
} as const;

function sciencedirectCleaner($: cheerio.CheerioAPI) {
  $("section").each((i, elem) => {
    if (
      $(elem).has(junkWords.map((x) => `h2:contains("${x}")`).join(", ")).length
     && $(elem).children("h2").text().split(" ").length < 6 ) {
      console.log("h2", $(elem).children("h2").text());
      $(elem).remove();
      return;
    }

    if (
      $(elem).has(junkWords.map((x) => `h3:contains("${x}")`).join(", ")).length
    && $(elem).children("h3").text().split(" ").length < 6 ) {
      console.log("h3", $(elem).children("h3").text());
      $(elem).remove();
      return;
    }

    if (
      $(elem).has(junkWords.map((x) => `h4:contains("${x}")`).join(", ")).length
    && $(elem).children("h4").text().split(" ").length < 6 ) {
      console.log("h4", $(elem).children("h4").text());
      $(elem).remove();
      return;
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
