'use strict'
// ----------------------- NOS MODULES -------------------------
const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const request = require('request');
const requestify = require('requestify');
const firebase = require('firebase');
const admin = require("firebase-admin");
let Wit = null;
let log = null;
try {
  Wit = require('../')
    .Wit;
  log = require('../')
    .log;
} catch (e) {
  Wit = require('node-wit')
    .Wit;
  log = require('node-wit')
    .log;
}
// ----------------------- FIREBASE INIT -------------------------
firebase.initializeApp({
  apiKey: "xxxx",
  authDomain: "xxxx",
  databaseURL: "xxxx",
  projectId: "xxxx",
  storageBucket: "xxxx",
  messagingSenderId: "xxxx"
});
admin.initializeApp({
  credential: admin.credential.cert({
    "type": "xxxx",
    "project_id": "xxxx",
    "private_key_id": "xxxx",
    "private_key": "xxxx",
    "client_email": "xxxx",
    "client_id": "xxxx",
    "auth_uri": "xxxx",
    "token_uri": "xxxx",
    "auth_provider_x509_cert_url": "xxxx",
    "client_x509_cert_url": "xxxx"
  }),
  databaseURL: "https://xxxx.firebaseio.com"
});
// ----------------------- API KEY openweathermap -------------------------
var api_key_weather = "xxxx";
// ----------------------- PARAMETRES DU SERVEUR -------------------------
const PORT = process.env.PORT || 5000;
// Wit.ai parameters
const WIT_TOKEN = "xxxx"; // saisir ici vos informations (infos sur session XX)
// Messenger API parameters
const FB_PAGE_TOKEN = "xxxx"; // saisir ici vos informations (infos sur session XX)
if (!FB_PAGE_TOKEN) {
  throw new Error('missing FB_PAGE_TOKEN')
}
const FB_APP_SECRET = "xxxx"; // saisir ici vos informations (infos sur session XX)
if (!FB_APP_SECRET) {
  throw new Error('missing FB_APP_SECRET')
}
let FB_VERIFY_TOKEN = "xxxx"; // saisir ici vos informations (infos sur session XX)
crypto.randomBytes(8, (err, buff) => {
  if (err) throw err;
  FB_VERIFY_TOKEN = buff.toString('hex');
  console.log(`/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"`);
});
// ----------------------- FONCTION POUR VERIFIER UTILISATEUR OU CREER ----------------------------
var checkAndCreate = (sessionId, fbid, prenom, nom, genre) => {
  return new Promise((resolve, reject) => {
    var userz = firebase.database()
      .ref()
      .child("accounts")
      .orderByChild("fbid")
      .equalTo(fbid)
      .once("value")
      .then(function(snapshot) {
        var exists = (snapshot.val() !== null);
        if (exists) {
          for (var key in snapshot.val()) break;
          console.log("Notre utilisateur existe et possède la clé : " + key);
          // on peut stocker ici la clé de notre utilisateur dans la session
          sessions[sessionId].key = key;
          resolve(key);
        } else {
          admin.auth()
            .createCustomToken(fbid)
            .then((customToken) => firebase.auth()
              .signInWithCustomToken(customToken))
            .then(() => {
              var user2 = firebase.auth()
                .currentUser;
              var keyid = firebase.database()
                .ref()
                .child('accounts')
                .push();
              sessions[sessionId].key = keyid.key;
              firebase.database()
                .ref()
                .child('accounts')
                .child(keyid.key)
                .set({
                  fbid: fbid,
                  prenom: prenom,
                  nom: nom,
                  genre: genre,
                  date: new Date()
                    .toISOString()
                });
              resolve(keyid.key);
            })
            .catch((error) => {
              console.log("Erreur depuis la fonction d'ecriture des informations utilisateur");
              reject(error);
            });
        }
      })
      .catch((error) => {
        console.log("Erreur depuis la fonction Check fbid Firebase");
        reject(error)
      });
  });
};
// ------------------------ FONCTION DEMANDE INFORMATIONS USER -------------------------
var requestUserName = (id) => {
  var qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/v2.8/' + encodeURIComponent(id) + '?' + qs)
    .then(rsp => rsp.json())
    .then(json => {
      if (json.error && json.error.message) {
        throw new Error(json.error.message);
      }
      return json;
    });
};
// ------------------------- ENVOI MESSAGES SIMPLES ( Texte, images, boutons génériques, ...) -----------
var fbMessage = (id, data) => {
  var body = JSON.stringify({
    recipient: {
      id
    },
    message: data,
  });
  console.log("BODY" + body);
  var qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body,
    })
    .then(rsp => rsp.json())
    .then(json => {
      if (json.error && json.error.message) {
        console.log(json.error.message + ' ' + json.error.type + ' ' + json.error.code + ' ' + json.error.error_subcode +
          ' ' + json.error.fbtrace_id);
      }
      return json;
    });
};
// ----------------------------------------------------------------------------
const sessions = {};
// ------------------------ FONCTION DE CREATION DE SESSION ---------------------------
var findOrCreateSession = (fbid) => {
  return new Promise((resolve, reject) => {
    let sessionId;
    Object.keys(sessions)
      .forEach(k => {
        if (sessions[k].fbid === fbid) {
          sessionId = k;
          console.log("jai deja une session" + sessionId);
        }
      });
    if (!sessionId) {
      sessionId = new Date()
        .toISOString();
      sessions[sessionId] = {
        fbid: fbid,
        context: {}
      };
    }
    requestUserName(fbid)
      .then(function(json) {
        sessions[sessionId].name = json.first_name;
        checkAndCreate(sessionId, fbid, json.first_name, json.last_name, json.gender)
          .then(function(lakey) {
            console.log("J'ai un clé utilisteur je peux resole : " + lakey);
            resolve(sessionId);
          })
          .catch(function(err) {
            console.error('Oops! Il y a une erreur checkAndCreate : ', err.stack || err);
            reject();
          });
      })
      .catch(function(err) {
        console.error('Oops! Il y a une erreur : ', err.stack || err);
        reject();
      });
  });
  //return sessionId;
};
// ------------------------ FONCTION DE RECHERCHE D'ENTITES ---------------------------
var firstEntityValue = function(entities, entity) {
  var val = entities && entities[entity] && Array.isArray(entities[entity]) && entities[entity].length > 0 &&
    entities[entity][0].value
  if (!val) {
    return null
  }
  return typeof val === 'object' ? val.value : val
}
// ------------------------ LISTE DE TOUTES VOS ACTIONS A EFFECTUER ---------------------------
var actions = {
  // fonctions genérales à définir ici
  send({
    sessionId
  }, response) {
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      if (response.quickreplies) {
        response.quick_replies = [];
        for (var i = 0, len = response.quickreplies.length; i < len; i++) {
          response.quick_replies.push({
            title: response.quickreplies[i],
            content_type: 'text',
            payload: response.quickreplies[i]
          });
        }
        delete response.quickreplies;
      }
      return fbMessage(recipientId, response)
        .then(() => null)
        .catch((err) => {
          console.log("Je send" + recipientId);
          console.error('Oops! erreur ', recipientId, ':', err.stack || err);
        });
    } else {
      console.error('Oops! utilisateur non trouvé : ', sessionId);
      return Promise.resolve()
    }
  },
  envoyer_message_text(sessionId, context, entities, text) {
    const recipientId = sessions[sessionId].fbid;
    var response = {
      "text": text
    };
    return fbMessage(recipientId, response)
      .then(() => {})
      .catch((err) => {
        console.log("Erreur envoyer_message_text" + recipientId);
      });
  },
  reset_context(entities, context, sessionId) {
    console.log("Je vais reset le context" + JSON.stringify(context));
    return new Promise(function(resolve, reject) {
      context = {};
      return resolve(context);
    });
  }
};
// --------------------- CHOISIR LA PROCHAINE ACTION (LOGIQUE) EN FCT DES ENTITES OU INTENTIONS------------
function choisir_prochaine_action(sessionId, context, entities) {
  // ACTION PAR DEFAUT CAR AUCUNE ENTITE DETECTEE
  if (Object.keys(entities)
    .length === 0 && entities.constructor === Object) {}
  // PAS DINTENTION DETECTEE
  if (!entities.intent) {}
  // IL Y A UNE INTENTION DETECTION : DECOUVRONS LAQUELLE AVEC UN SWITCH
  else {
    switch (entities.intent && entities.intent[0].value) {
      case "Dire_Bonjour":
        actions.envoyer_message_text(sessionId, context, entities, 'Bonjour mon cher utilisateur !');
        break;
    };
  }
};
// --------------------- FONCTION POUR AFFICHER LA METEO EN FCT DE LA LAT & LNG ------------
// --------------------- LE SERVEUR WEB ------------
const wit = new Wit({
  accessToken: WIT_TOKEN,
  actions,
  logger: new log.Logger(log.INFO)
});
const app = express();
app.use(({
  method,
  url
}, rsp, next) => {
  rsp.on('finish', () => {
    console.log(`${rsp.statusCode} ${method} ${url}`);
  });
  next();
});
app.use(bodyParser.json({
  verify: verifyRequestSignature
}));
// ------------------------- LE WEBHOOK / hub.verify_token à CONFIGURER AVEC LE MEME MOT DE PASSE QUE FB_VERIFY_TOKEN ------------------------
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === "xxxx") { // remplir ici à la place de xxxx le meme mot de passe que FB_VERIFY_TOKEN
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});
// ------------------------- LE WEBHOOK / GESTION DES EVENEMENTS ------------------------
app.post('/webhook', (req, res) => {
  const data = req.body;
  if (data.object === 'page') {
    data.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message && !event.message.is_echo) {
          var {
            text,
            attachments,
            quick_reply
          } = event.message;

          function hasValue(obj, key) {
            return obj.hasOwnProperty(key);
          }
          console.log(JSON.stringify(event.message));
          // -------------------------- MESSAGE IMAGE OU GEOLOCALISATION ----------------------------------
          if (event.message.attachments != null && typeof event.message.attachments[0] != 'undefined') {
            // envoyer à Wit.ai ici
          }
          // --------------------------- MESSAGE QUICK_REPLIES --------------------
          else if (hasValue(event.message, "text") && hasValue(event.message, "quick_reply")) {
            // envoyer à Wit.ai ici
          }
          // ----------------------------- MESSAGE TEXT ---------------------------
          else if (hasValue(event.message, "text")) {
            // envoyer à Wit.ai ici
            var sender = event.sender.id;
            findOrCreateSession(sender)
              .then(function(sessionId) {
                wit.message(text, sessions[sessionId].context)
                  .then(
                    ({
                      entities
                    }) => {
                      choisir_prochaine_action(sessionId, sessions[sessionId].context, entities);
                      console.log('Yay, on a une response de Wit.ai : ' + JSON.stringify(entities));
                    })
                  .catch(console.error);
              });
          }
          // ----------------------------------------------------------------------------
          else {
            // envoyer à Wit.ai ici
          }
        }
        // ----------------------------------------------------------------------------
        else if (event.postback && event.postback.payload) {
          var sender = event.sender.id;
          findOrCreateSession(sender)
            .then(function(sessionId) {
              // envoyer à Wit.ai ici 
            });
        }
        // ----------------------------------------------------------------------------
        else {
          console.log('received event : ', JSON.stringify(event));
        }
      });
    });
  }
  res.sendStatus(200);
});
// ----------------- VERIFICATION SIGNATURE -----------------------
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];
  if (!signature) {
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];
    var expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
      .update(buf)
      .digest('hex');
    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}
app.listen(PORT);
console.log('Listening on :' + PORT + '...');
