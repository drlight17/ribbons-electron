import path from "path"
import { fileURLToPath } from 'url';
import { dialog, app } from 'electron'
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*let Store = undefined;

if (process.versions.electron != "22.3.27") {
    Store = require('electron-store').default;
} else {
    Store = require('electron-store');
}*/

import Store from 'electron-store';

let loadedLanguage;
let loadedLanguageTag;
//let app = electron.app ? electron.app : electron.remote.app

//export default i18n;
// preprocess -dev path
if (!app.isPackaged) {
  let current_app_dir = app.getPath('userData')
  // don't delete if already not empty userData folder from prod app
  if (fs.readdirSync(current_app_dir).length === 0) {
    fs.rmSync(current_app_dir, { recursive: true, force: true });
  }
  app.setPath ('userData', current_app_dir+"-dev");
}

const store = new Store();

// get all locales list
const dirCont = fs.readdirSync( __dirname );

var lang_files = dirCont.filter( ( elm ) => elm.match(/.*\.(json?)/ig));
var lang_files_processed = [];
lang_files.forEach((locale) => {
    lang_files_processed.push(locale.replace('.json',''))
})

class I18n {
    constructor() {
        // check if no saved locale
        try {
            if ((store.get('locale')  == undefined) || (store.get('locale') == "")) {

                if (fs.existsSync(path.join(__dirname, app.getLocaleCountryCode().toLowerCase() + '.json'))) {
                    loadedLanguageTag = app.getLocaleCountryCode().toLowerCase();
                }
                else {
                    loadedLanguageTag = 'en'
                }

                loadedLanguage = JSON.parse(fs.readFileSync(path.join(__dirname, loadedLanguageTag + '.json' ), 'utf8'))
                store.set('locale',loadedLanguageTag);
            } else {
                loadedLanguageTag = store.get('locale');
                loadedLanguage = JSON.parse(fs.readFileSync(path.join(__dirname, loadedLanguageTag + '.json'), 'utf8'));
            }
        }
        catch (err) {
            console.log(err);
            dialog.showErrorBox('Error', 'Lang file processing fail! Check for existense of translations dir with lang json files and their consistense!');
            try {
                fs.unlinkSync(app.getPath('userData')+"/config.json");
                dialog.showErrorBox('Warn','Config file is cleared. Try app launch again.');
            }
            catch (unlinkErr) {
                console.error('Could not clear config file:', unlinkErr);
            }
            //app.relaunch();
            app.exit(1); // Use exit code 1 for error
        }
    }


    __(phrase) {
        return loadedLanguage[phrase] ?? phrase;
    }

    ___(phrase) {
        if (phrase === 'get_locales') {
            return lang_files_processed;
        }
    }
}

export default new I18n();