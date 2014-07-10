/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

importScripts("tokenizerFactory.js");

function KeywordsWorkerError(message) {
    this.name = "KeywordsWorkerError";
    this.message = message || "KeywordsWorker has errored";
}

function log(msg) {
  dump("-*- keywordsWorker -*- " + msg + '\n')
}

KeywordsWorkerError.prototype = new Error();
KeywordsWorkerError.prototype.constructor = KeywordsWorkerError;

let gQueryParams = ["q", "search_query", "query", "search", "queryString"];
let gNamespace = null;
let gRegionCode = null
let gTokenizer = null;
let gWordPrefixes = null;
let gStopwords = null;
let gNumbersPattern = /\d/;
let gSearchPattern = /[Ss]earch/g;

// bootstrap the worker with data and models
function bootstrap(aMessageData) {
  gRegionCode = aMessageData.workerRegionCode;
  gNamespace = aMessageData.workerNamespace;
  gWordPrefixes = aMessageData.wordPrefixes;
  gStopwords = aMessageData.stopwords;

  if (aMessageData.urlStopwordSet) {
    gTokenizer = tokenizerFactory.getTokenizer({
      urlStopwordSet: aMessageData.urlStopwordSet,
      regionCode: gRegionCode,
    });
  }

  self.postMessage({
    message: "bootstrapComplete"
  });
}

/**
 * Return whether the validation trie contains the first three
 * letters of a given token.
 */
function _tokenIsValid(token) {
  let currentPosition = gWordPrefixes;
  let isValid = false;
  for (let i=0;  i < token.length; i++) {
    if (currentPosition.hasOwnProperty(token[i])) {
      currentPosition = currentPosition[token[i]];
      if (currentPosition == 0) {
        isValid = true;
        break;
      }
    }
    else {
      break;
    }
  }
  return isValid;
}

function extractSearchQueries({url}) {
  let tokenSet = {};
  if (url.search(gSearchPattern) != -1) {
    let u = new URL(url);
    let params = u.searchParams;
    for (let query of gQueryParams) {
      if (params.has(query)) {
        let queryTokens = gTokenizer.tokenize("", params.get(query));
        for (let token of queryTokens) {
          if (token.length > 0 && !gStopwords.hasOwnProperty(token)) {
            tokenSet[token] = true;
          }
        }
      }
    }
  }
  return Object.keys(tokenSet);
}

// obtain unique keywords from a url and a title
function extractUniqueKeywords({url, title, publicSuffix}) {
  if (gTokenizer == null) {
    return [];
  }

  let tokens = gTokenizer.tokenize(url, title);
  let tokenSet = {};
  for (let token of tokens) {
    if (token.length >= 3 && token.search(gNumbersPattern) == -1 && !gStopwords.hasOwnProperty(token) && _tokenIsValid(token)) {
      tokenSet[token] = true;
    }
  }

  // remove public suffix tokens
  if (publicSuffix && publicSuffix != "") {
    let psTokens = gTokenizer.tokenize("", publicSuffix);
    for (let part of psTokens) {
      if (tokenSet[part]) {
        delete tokenSet[part];
      }
    }
  }

  return Object.keys(tokenSet);
}

function getKeywordsForDocument(aMessageData) {
  aMessageData.message = "KeywordsForDocument";
  aMessageData.namespace = gNamespace;

  let results = [];
  try {
    let keywords = extractUniqueKeywords(aMessageData);
    results.push({type: "url_title", keywords: keywords});

    keywords = extractUniqueKeywords({url: "", title: aMessageData.title});
    results.push({type: "title", keywords: keywords});

    let searchQueries = extractSearchQueries(aMessageData);
    if (searchQueries.length > 0) {
      results.push({type: "search", keywords: searchQueries});
    }

    aMessageData.results = results;
    self.postMessage(aMessageData);
  }
  catch (ex) {
    log("getKeywordsForDocument: " + ex)
  }
}

// Dispatch the message to the appropriate function
self.onmessage = function({data}) {
  self[data.command](data.payload);
};
