/* OpenAlex API */
// https://docs.openalex.org/about-the-data/work#the-work-object

async function openAlexWrapper(
  ids: string[],
  responseFunction,
  isLoadingProgress = false,
  getCitations = false
) {
  const responses = [];
  ids = ids.map((id) => {
    if (!id) return undefined;
    else if (id.includes("https://")) return id;
    else if (id.toLowerCase().match(/openalex:|doi:|mag:|pmid:|pmcid:/))
      return id.toLowerCase();
    else if (id.includes("/")) return "doi:" + id;
    else return "openalex:" + id;
  });
  for (const i of Array(ids.length).keys()) {
    let response;
    if (ids[i]) {
      response = await openAlexWorks(
        "/" +
          ids[i].replace("openalex:", "") +
          "?select=id,doi,display_name,authorships,publication_year,primary_location,referenced_works,cited_by_count,abstract_inverted_index,is_retracted"
      );
      if (getCitations && response.id) {
        // TODO These results are incomplete when a paper is cited by >200 (current per-page upper-limit of OA)
        const citations = await openAlexWorks(
          "?select=id&per-page=200&sort=cited_by_count:desc&filter=cites:" +
            response.id.replace("https://openalex.org/", "")
        );
        if (citations) {
          response.citations = citations;
        }
      }
    }
    responses.push(response);
  }
  responseFunction(responses);
}

function openAlexWorks(suffix: string) {
  return fetch(
    "https://api.openalex.org/works" +
      suffix +
      "&mailto=local-citation-network@timwoelfle.de"
  )
    .then((response) => {
      if (!response.ok) throw response;
      return response.json();
    })
    .catch(async function (response) {
      if (response.status === 429 || typeof response.statusText !== "string") {
        console.log("OpenAlex (OA) not reachable. Waiting 2 minutes...");
        await new Promise((resolve) => setTimeout(resolve, 12000));
        return openAlexWorks(suffix);
      }
      // vm.errorMessage('Error while processing data through OpenAlex API for ' + suffix.substr(1).replace(/\?.*/, '') + ': ' + response.statusText)
      return false;
    });
}

function openAlexResponseToArticleArray(data) {
  return data.filter(Boolean).map((article) => {
    const doi = article.doi
      ? article.doi.replace("https://doi.org/", "").toUpperCase()
      : undefined;

    return {
      id: article.id.replace("https://openalex.org/", ""),
      numberInSourceReferences: data.indexOf(article) + 1,
      doi: doi,
      title: article.display_name || "",
      authors: (article.authorships || []).map((authorship) => {
        const display_name = authorship.author.display_name || "";
        const cutPoint =
          display_name.lastIndexOf(",") !== -1
            ? display_name.lastIndexOf(",")
            : display_name.lastIndexOf(" ");
        return {
          id:
            authorship.author.id &&
            authorship.author.id.replace("https://openalex.org/", ""),
          orcid:
            authorship.author.orcid &&
            authorship.author.orcid.replace("https://orcid.org/", ""),
          LN: display_name.substr(cutPoint + 1),
          FN: display_name.substr(0, cutPoint),
          affil:
            (authorship.institutions || [])
              .map(
                (institution) =>
                  institution.display_name +
                  (institution.country_code
                    ? " (" + institution.country_code + ")"
                    : "")
              )
              .join(", ") || undefined
        };
      }),
      year: article.publication_year,
      journal:
        (article.primary_location &&
          article.primary_location.source &&
          article.primary_location.source.display_name +
            (article.primary_location.source.host_organization_name &&
            !article.primary_location.source.display_name.includes(
              article.primary_location.source.host_organization_name
            )
              ? " (" +
                article.primary_location.source.host_organization_name +
                ")"
              : "")) ??
        undefined,
      references: (article.referenced_works || []).map((x) =>
        x.replace("https://openalex.org/", "")
      ),
      citations: article.citations
        ? article.citations.results.map((x) =>
            x.id.replace("https://openalex.org/", "")
          )
        : [],
      citationsCount: article.cited_by_count,
      abstract: article.abstract_inverted_index
        ? revertAbstractFromInvertedIndex(article.abstract_inverted_index)
        : undefined,
      isRetracted: article.is_retracted
    };
  });
}

function revertAbstractFromInvertedIndex(abstract_inverted_index: {
  [key: string]: number[];
}) {
  const abstract = [];
  Object.keys(abstract_inverted_index).forEach((word) =>
    abstract_inverted_index[word].forEach((i) => {
      abstract[i] = word;
    })
  );
  return abstract.join(" ").replaceAll("  ", " ").trim();
}
