/* eslint-disable no-async-promise-executor */
/* eslint-disable prefer-const */
/* eslint-disable functional/immutable-data */
/* eslint-disable functional/no-let */
import fsProm from "fs/promises";
import path from "path";

import chalk from "chalk";
//import translate from "google-translate-open-api";
import inquirer from "inquirer";
import autocomplete from 'inquirer-autocomplete-prompt';
import fuzzypath from 'inquirer-fuzzy-path';
import { get } from "lodash";
import fetch from "node-fetch";
import ProgressBar from "progress";

import languages from "./languages.json";



inquirer.registerPrompt('fuzzypath', fuzzypath)
inquirer.registerPrompt('autocomplete', autocomplete);


const notAllowed = [
  "node_modules",
  "build",
  "src",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "tsconfig.module.json",
];

const asyncRun = async () => {

  const answered = await inquirer.prompt([
    {
      type: 'fuzzypath',
      name: 'path',
      excludePath: (nodePath: string) => notAllowed.map(value => nodePath.includes(value)).includes(true),
      excludeFilter: (nodePath: string) => nodePath === '.' || !nodePath.includes(".json") || nodePath.startsWith("."),
      itemType: 'file',
      rootPath: ".",
      message: 'Select the sshbot language file to translate:',
      suggestOnly: false,
      depthLimit: 5,
    },
    {
      type: 'autocomplete',
      name: 'language',
      message: 'Select a language for translation',
      source: (_answersSoFar: string, input: string) => searchArray(Object.keys(languages), input)
    },
    {
      type: "confirm",
      message: "Wait between requests?",
      name: "skip"
    }
  ])
  const res: string = answered?.path;

  if (!res)
    return console.log(chalk`{red Please choose a path}`);

  const languageFileRaw = await fsProm.readFile(path.join(process.cwd(), res), "utf8");
  const languageFile = JSON.parse(languageFileRaw);
  const languageKey = languages[answered?.language];

  await processReferences(languageFile, languageKey, answered?.skip);

  fsProm.writeFile(`${languageKey}.json`, JSON.stringify(languageFile));
}

asyncRun();

function searchArray(array: readonly string[], input: string) {
  if (input === undefined) return array;
  const searched = array.map(value => {
    const Includes = value.includes(input);

    if (Includes)
      return value;

    return undefined;
  });

  let filtered = [];

  searched.forEach(value => {
    if (value !== undefined) {
      filtered.push(value);
    }
  });

  return filtered;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processReferences(messages: any, toLanguage: string, skipWaiting = false, originalMessages?: unknown, progress?: ProgressBar, path = ""): Promise<unknown> {
  return new Promise(async resolve => {
    if (originalMessages === undefined) originalMessages = messages;

    if (progress === undefined) {
      let values = countValues(originalMessages);

      progress = new ProgressBar(":bar :percent :current/:total ETA: :eta :status", { total: values, width: 40, complete: "\u2588", incomplete: "\u2591" })
    }


    // eslint-disable-next-line functional/no-loop-statement
    for (const k in messages) {
      if (typeof messages[k] == "object" && messages[k] !== null)
        await processReferences(messages[k], toLanguage, skipWaiting, originalMessages, progress, `${path}.${k}`);
      else {
        const regex = /^§!{.*}$/g;

        if (regex.test(messages[k])) {
          const lookUp = messages[k].substring(3, messages[k].length - 1);
          const match =
            get(originalMessages, lookUp) as string || "Error looking up index. Contact the developers! https://discord.gg/WHYhUF4";

          messages[k] = match;
        }

        const emojiRegex = /(<:|<a:)((\w{1,64}:\d{17,18}))(>)/gim;
        const msg: string = messages[k];

        if (msg !== undefined && typeof msg === 'string' && k !== "usage" && !path.includes("examples") && !path.includes("aliases")) {
          const array = msg.match(emojiRegex);
          const filtered = msg.replace(emojiRegex, "").split("\n");

          const requestUrl = `https://api.microsofttranslator.com/v2/ajax.svc/TranslateArray?appId=%22TlNZarnQP6YQDHSwVGXO-Q-x-x3habdzUZ7omWmglAgM*%22&texts=[${filtered.map(value => `"${encodeURIComponent(value)}"`).join(",")}]&to=%22${toLanguage}%22&ctr=&ref=WidgetV2&rgp=22d9c751`;

          progress.tick(0, {
            status: "Translating..."
          });

          const response = (await (await fetch(requestUrl)).text()).substring(1);

          const json: readonly MicrosoftTranslate[] = JSON.parse(response);

          if (!skipWaiting) {
            progress.tick(0, {
              status: "Waiting..."
            });
            await delay(100, "waiting");
          }

          progress.tick(1, {
            status: "Finalizing..."
          });

          let addEmoji = "";
          if (array)
            addEmoji = array.join(" ") + " "

          if (response.includes("IP is over the quota")) {
            console.log(chalk`\n\n\n{red QUOTA LIMIT EXCEEDED}`);
            process.exit(0);
          }

          if (!json[0].TranslatedText) {
            console.log(chalk`\n\n\n{red TRANSLATION ERROR: ${response}}`)
            messages[k] = `TRANSLATION ERROR: ${response}`;
          } else {
            let joined = json.map(value => `${value.TranslatedText}`).join("\n");
            let final = `${addEmoji}${joined}`;
            messages[k] = final;
          }

        }
      }
    }

    resolve(true);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countValues(messages: any, currentValue = 0) {
  // eslint-disable-next-line functional/no-loop-statement
  for (const k in messages) {
    if (typeof messages[k] == "object" && messages[k] !== null) {
      currentValue = countValues(messages[k], currentValue);
    } else {
      currentValue += 1;
    }
  }

  return currentValue;
}

function delay(t, val) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve(val);
    }, t);
  });
}

export type MicrosoftTranslate = {
  readonly From: string;
  readonly OriginalTextSentenceLengths: readonly number[];
  readonly TranslatedText: string;
  readonly TranslatedTextSentenceLengths: readonly number[];
};
