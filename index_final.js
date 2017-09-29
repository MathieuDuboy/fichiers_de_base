'use strict'
// ----------------------- NOS MODULES -------------------------
const bodyParser = require( 'body-parser' );
const crypto = require( 'crypto' );
const express = require( 'express' );
const fetch = require( 'node-fetch' );
const request = require( 'request' );
const requestify = require( 'requestify' );
const firebase = require('firebase');
const admin = require("firebase-admin");

let Wit = null;
let log = null;
try {
  Wit = require( '../' ).Wit;
  log = require( '../' ).log;
} catch ( e ) {
  Wit = require( 'node-wit' ).Wit;
  log = require( 'node-wit' ).log;
}

// ----------------------- FIREBASE INIT -------------------------
firebase.initializeApp(
  {
    apiKey: "xxxx",
     authDomain: "xxxx",
     databaseURL: "xxxx",
     projectId: "xxxx",
     storageBucket: "xxxx",
     messagingSenderId: "xxxx"
  }
);

admin.initializeApp( {
  credential: admin.credential.cert( {
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
const WIT_TOKEN = "xxxx";   // saisir ici vos informations (infos sur session XX)
// Messenger API parameters
const FB_PAGE_TOKEN = "xxxx";   // saisir ici vos informations (infos sur session XX)
if ( !FB_PAGE_TOKEN ) {
  throw new Error( 'missing FB_PAGE_TOKEN' )
}
const FB_APP_SECRET = "xxxx";   // saisir ici vos informations (infos sur session XX)
if ( !FB_APP_SECRET ) {
  throw new Error( 'missing FB_APP_SECRET' )
}
let FB_VERIFY_TOKEN = "xxxx";   // saisir ici vos informations (infos sur session XX)
crypto.randomBytes( 8, ( err, buff ) => {
  if ( err ) throw err;
  FB_VERIFY_TOKEN = buff.toString( 'hex' );
  console.log( `/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"` );
} );
// ----------------------- FONCTION POUR VERIFIER UTILISATEUR OU CREER ----------------------------
var checkAndCreate = (fbid, prenom, nom, genre) => {
	var userz = firebase.database()
		.ref()
		.child("accounts")
		.orderByChild("fbid")
		.equalTo(fbid)
		.once("value", function(snapshot) {
				admin.auth()
					.createCustomToken(fbid)
					.then(function(customToken) {
						firebase.auth()
							.signInWithCustomToken(customToken)
							.then(function() {
								//inserer notre compte
								var user2 = firebase.auth().currentUser;
								var keyid = firebase.database()
									.ref()
									.child('accounts')
									.push();
								firebase.database()
									.ref()
									.child('accounts')
									.child(keyid.key)
									.set({
										fbid: fbid,
                    prenom : prenom,
                    nom : nom,
                    genre : genre,
										date: new Date()
											.toISOString()
									})
									.catch(function(error2) {
										console.log(error2);
									});
							})
							.catch(function(error) {
								// Handle Errors here.
								var errorCode = error.code;
								var errorMessage = error.message;
							});
					})
					.catch(function(error3) {
						console.log("Erreur : "+ error3);
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
var fbMessage = ( id, data ) => {
  var body = JSON.stringify( {
    recipient: {
      id
    },
    message: data,
  } );
  console.log( "BODY" + body );
  var qs = 'access_token=' + encodeURIComponent( FB_PAGE_TOKEN );
  return fetch( 'https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body,
  } ).then( rsp => rsp.json() ).then( json => {
    if ( json.error && json.error.message ) {
      console.log( json.error.message + ' ' + json.error.type + ' ' +
        json.error.code + ' ' + json.error.error_subcode + ' ' + json.error
        .fbtrace_id );
    }
    return json;
  } );
};
// ----------------------------------------------------------------------------
const sessions = {};
// ------------------------ FONCTION DE CREATION DE SESSION ---------------------------
var findOrCreateSession = (fbid) => {
	let sessionId;
	Object.keys(sessions)
		.forEach(k => {
			if (sessions[k].fbid === fbid) {
				sessionId = k;
			}
		});
	if (!sessionId) {
		sessionId = new Date()
			.toISOString();
		sessions[sessionId] = {
			fbid: fbid,
			context: {}
		};
    requestUserName(fbid)
      .then((json) => {
        sessions[sessionId].name = json.first_name;
				checkAndCreate(fbid, json.first_name,  json.last_name, json.gender);
      })
      .catch((err) => {
        console.error('Oops! Il y a une erreur : ', err.stack || err);
      });
	}
	return sessionId;
};
// ------------------------ FONCTION DE RECHERCHE D'ENTITES ---------------------------
var firstEntityValue = function( entities, entity ) {
    var val = entities && entities[ entity ] && Array.isArray( entities[ entity ] ) &&
      entities[ entity ].length > 0 && entities[ entity ][ 0 ].value
    if ( !val ) {
      return null
    }
  return typeof val === 'object' ? val.value : val
}
// ------------------------ LISTE DE TOUTES VOS ACTIONS A EFFECTUER ---------------------------

var actions = {
  // fonctions genérales à définir ici
  send( {sessionId}, response ) {
    const recipientId = sessions[ sessionId ].fbid;
    if ( recipientId ) {
      if ( response.quickreplies ) {
        response.quick_replies = [];
        for ( var i = 0, len = response.quickreplies.length; i < len; i++ ) {
          response.quick_replies.push( {
            title: response.quickreplies[ i ],
            content_type: 'text',
            payload: response.quickreplies[ i ]
          } );
        }
        delete response.quickreplies;
      }
      return fbMessage( recipientId, response )
        .then( () => null )
        .catch( ( err ) => {
          console.log( "Je send" + recipientId );
          console.error(
            'Oops! erreur ',
            recipientId, ':', err.stack || err );
        } );
    } else {
      console.error( 'Oops! utilisateur non trouvé : ', sessionId );
      return Promise.resolve()
    }
  },
  getUserName( sessionId, context, entities ) {
    const recipientId = sessions[ sessionId ].fbid;
    const name = sessions[ sessionId ].name || null;
    return new Promise( function( resolve, reject ) {
      if ( recipientId ) {
        if ( name ) {
            context.userName = name;
            resolve( context );
        } else {
          requestUserName( recipientId )
            .then( ( json ) => {
              sessions[ sessionId ].name = json.first_name;
              context.userName = json.first_name; // Stockage prénom dans le context !
              resolve( context );
            } )
            .catch( ( err ) => {
              console.log( "ERROR = " + err );
              console.error(
                'Oops! Erreur : ',
                err.stack || err );
              reject( err );
            } );
        }
      } else {
        console.error( 'Oops! pas trouvé user :',
          sessionId );
        reject();
      }
    } );
  },
  envoyer_message_text( sessionId, context, entities, text ) {
    const recipientId = sessions[ sessionId ].fbid;
    var response = {
      "text": text
    };
    return fbMessage( recipientId, response )
      .then( () => {} )
      .catch( ( err ) => {
        console.log( "Erreur envoyer_message_text" + recipientId );
      } );
  },
  envoyer_message_bouton_generique( sessionId, context, entities, elements ) {
    const recipientId = sessions[ sessionId ].fbid;
    return fbMessage( recipientId, elements )
      .then( () => {} )
      .catch( ( err ) => {
        console.log( "Erreur envoyer_message_bouton_generique" + recipientId );
      } );
  },
  envoyer_message_quickreplies( sessionId, context, entities, text, quick ) {
    const recipientId = sessions[ sessionId ].fbid;
    var response2 = {
      "text": text,
      "quick_replies": quick
    };
    return fbMessage( recipientId, response2 )
      .then( () => {} )
      .catch( ( err ) => {
        console.log( "Erreur envoyer_message_text" + recipientId );
      } );
  },
  envoyer_message_image( sessionId, context, entities, image_url ) {
    const recipientId = sessions[ sessionId ].fbid;
    var response = {
        "attachment":{
        "type":"image",
        "payload":{
          "url": image_url
        }
      }
    };
    return fbMessage( recipientId, response )
      .then( () => {} )
      .catch( ( err ) => {
        console.log( "Erreur envoyer_message_text" + recipientId );
      } );
  },
  reset_context( entities, context, sessionId ) {
    console.log( "Je vais reset le context" + JSON.stringify( context ) );
    return new Promise( function( resolve, reject ) {
      context = {};
      return resolve( context );
    } );
  }
};
// --------------------- CHOISIR LA PROCHAINE ACTION (LOGIQUE) EN FCT DES ENTITES OU INTENTIONS------------
function choisir_prochaine_action( sessionId, context, entities ) {
  // ACTION PAR DEFAUT CAR AUCUNE ENTITE DETECTEE
  if(Object.keys(entities).length === 0 && entities.constructor === Object) {
    // Affichage message par defaut : Je n'ai pas compris votre message !
  }
  // PAS DINTENTION DETECTEE
  if(!entities.intent) {
    if(entities.location && entities.location[ 0 ].value) {
      // Une ville est détectée !
      var ville = entities.location[ 0 ].value;
      var quick =  [
          {
            "content_type":"text",
            "title":"Retour accueil",
            "payload": "RETOUR_ACCUEIL"
          },
          {
            "content_type":"text",
            "title":"Au revoir",
            "payload": "Dire_aurevoir"
          }
        ];
      actions.envoyer_message_text( sessionId, context, entities, 'On affiche donc la méteo de '+ville).then(function() {
        var city = entities.location[ 0 ].value;
        requestify.get("http://api.openweathermap.org/data/2.5/weather?APPID="+api_key_weather+"&q="+city, {} ).then( function( response )  {
            var body = JSON.parse(response.body);
            var temperature = parseInt(body.main.temp);
            var tempC = Math.round(temperature - 273.15); // Degrès Kelvin tranformés en Celsius
            actions.envoyer_message_text( sessionId, context, entities, "Il fait "+tempC+"°C aujourd'hui à "+entities.location[ 0 ].value).then(function() {
                actions.envoyer_message_quickreplies(sessionId, context, entities, "Que souhaitez-vous faire maintenant ?", quick);
            })
        })
      })
    }
  }
  // IL Y A UNE INTENTION DETECTEE : DECOUVRONS LAQUELLE AVEC UN SWITCH
  else {
    switch ( entities.intent && entities.intent[ 0 ].value ) {
      case "Dire_Bonjour":
        var msg = {
          "attachment": {
            "type": "template",
            "payload": {
              "template_type": "generic",
              "elements": [
                 {
                  "title": "à Arcachon",
                  "image_url": "https://mon-chatbot.com/img/arcachon.jpg",
                  "subtitle": "Appuyez ici pour connaitre la météo d'Arcachon",
                  "buttons": [
                    {
                      "type": "postback",
                      "payload": "Arcachon",
                      "title": "Découvrir"
                  }]
                },
                {
                 "title": "à Bordeaux",
                 "image_url": "https://mon-chatbot.com/img/bordeaux.jpg",
                 "subtitle": "Appuyez ici pour connaitre la météo de Bordeaux",
                 "buttons": [
                   {
                     "type": "postback",
                     "payload": "Bordeaux",
                     "title": "Découvrir"
                 }]
               },
               {
                "title": "à Strasbourg",
                "image_url": "https://mon-chatbot.com/img/strasbourg.jpg",
                "subtitle": "Appuyez ici pour connaitre la météo de Strasbourg",
                "buttons": [
                  {
                    "type": "postback",
                    "payload": "Strasbourg",
                    "title": "Découvrir"
                }]
              },
              {
               "title": "à Toulouse",
               "image_url": "https://mon-chatbot.com/img/toulouse.jpg",
               "subtitle": "Appuyez ici pour connaitre la météo de Toulouse",
               "buttons": [
                 {
                   "type": "postback",
                   "payload": "Toulouse",
                   "title": "Découvrir"
               }]
             },
             {
              "title": "à Lyon",
              "image_url": "https://mon-chatbot.com/img/lyon.jpg",
              "subtitle": "Appuyez ici pour connaitre la météo de Lyon",
              "buttons": [
                {
                  "type": "postback",
                  "payload": "Lyon",
                  "title": "Découvrir"
              }]
            },
               {
                "title": "en France",
                "image_url": "https://mon-chatbot.com/img/france.jpg",
                "subtitle": "Voir la météo pour toute la France",
                "buttons": [
                  {
                   "type":"web_url",
                   "url":"http://www.meteofrance.com/accueil",
                   "title":"Découvrir"
                 }]
              }
            ]
            }
          }
        };
        actions.reset_context( entities, context, sessionId ).then(function() {
          actions.getUserName( sessionId, context, entities ).then( function() {
            actions.envoyer_message_text( sessionId, context, entities, 'Bonjour '+context.userName+' et bienvenue sur votre assistant météo. Dans quelle ville souhaitez-vous connaitre la météo.').then(function() {
                actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
            })
          })
        })
        break;
      case "demander_meteo":
        if (entities.location && entities.location[ 0 ].value)
        {
          var ville = entities.location[ 0 ].value;
          var quick =  [
              {
                "content_type":"text",
                "title":"Retour accueil",
                "payload": "RETOUR_ACCUEIL"
              },
              {
                "content_type":"text",
                "title":"Au revoir",
                "payload": "Dire_aurevoir"
              }
            ];
          actions.envoyer_message_text( sessionId, context, entities, 'On affiche donc la méteo de '+ville).then(function() {
            var city = entities.location[ 0 ].value;
            requestify.get("http://api.openweathermap.org/data/2.5/weather?APPID="+api_key_weather+"&q="+city, {} ).then( function( response )  {
                var body = JSON.parse(response.body);
                var temperature = parseInt(body.main.temp);
                var tempC = Math.round(temperature - 273.15); // Degrès Kelvin tranformés en Celsius
                actions.envoyer_message_text( sessionId, context, entities, "Il fait "+tempC+"°C aujourd'hui à "+entities.location[ 0 ].value).then(function() {
                    actions.envoyer_message_quickreplies(sessionId, context, entities, "Que souhaitez-vous faire maintenant ?", quick);
                })
            })
          })
        }
        else {
          // La ville n'est pas reconnue. On demande à l'utilisateur de renseigner sa ville
          var quick =  [
              {
                "content_type":"location"
              }
            ];
          actions.reset_context( entities, context, sessionId ).then(function() {
              actions.envoyer_message_text( sessionId, context, entities, 'Dans quelle ville dois-je chercher la méteo ?').then(function() {
                actions.envoyer_message_quickreplies(sessionId, context, entities, "Vous pouvez vous geolocaliser ou ecrire le nom d'une ville de votre choix.", quick);
              })
          })
          break;
        }
      case "RETOUR_ACCUEIL":
        // Revenir à l'accueil et changer de texte
        var msg = {
          "attachment": {
            "type": "template",
            "payload": {
              "template_type": "generic",
              "elements": [
                 {
                  "title": "à Arcachon",
                  "image_url": "https://mon-chatbot.com/img/arcachon.jpg",
                  "subtitle": "Appuyez ici pour connaitre la météo d'Arcachon",
                  "buttons": [
                    {
                      "type": "postback",
                      "payload": "Arcachon",
                      "title": "Découvrir"
                  }]
                },
                {
                 "title": "à Bordeaux",
                 "image_url": "https://mon-chatbot.com/img/bordeaux.jpg",
                 "subtitle": "Appuyez ici pour connaitre la météo de Bordeaux",
                 "buttons": [
                   {
                     "type": "postback",
                     "payload": "Bordeaux",
                     "title": "Découvrir"
                 }]
               },
               {
                "title": "à Strasbourg",
                "image_url": "https://mon-chatbot.com/img/strasbourg.jpg",
                "subtitle": "Appuyez ici pour connaitre la météo de Strasbourg",
                "buttons": [
                  {
                    "type": "postback",
                    "payload": "Strasbourg",
                    "title": "Découvrir"
                }]
              },
              {
               "title": "à Toulouse",
               "image_url": "https://mon-chatbot.com/img/toulouse.jpg",
               "subtitle": "Appuyez ici pour connaitre la météo de Toulouse",
               "buttons": [
                 {
                   "type": "postback",
                   "payload": "Toulouse",
                   "title": "Découvrir"
               }]
             },
             {
              "title": "à Lyon",
              "image_url": "https://mon-chatbot.com/img/lyon.jpg",
              "subtitle": "Appuyez ici pour connaitre la météo de Lyon",
              "buttons": [
                {
                  "type": "postback",
                  "payload": "Lyon",
                  "title": "Découvrir"
              }]
            },
               {
                "title": "en France",
                "image_url": "https://mon-chatbot.com/img/france.jpg",
                "subtitle": "Voir la météo pour toute la France",
                "buttons": [
                  {
                   "type":"web_url",
                   "url":"http://www.meteofrance.com/accueil",
                   "title":"Découvrir"
                 }]
              }
            ]
            }
          }
        };
        actions.reset_context( entities, context, sessionId ).then(function() {
          actions.getUserName( sessionId, context, entities ).then( function() {
            actions.envoyer_message_text( sessionId, context, entities, 'Retournons au départ '+context.userName+'. Dans quelle ville souhaitez-vous connaitre la météo.').then(function() {
                actions.envoyer_message_bouton_generique(sessionId, context, entities, msg);
            })
          })
        })
        break;
      case "Dire_aurevoir":
        actions.getUserName( sessionId, context, entities ).then( function() {
          actions.envoyer_message_text( sessionId, context, entities, "A bientôt "+context.userName+" ! N'hésitez-pas à revenir nous voir très vite !").then(function() {
              actions.envoyer_message_image( sessionId, context, entities, "https://mon-chatbot.com/img/byebye.jpg" );
          })
        })
        break;
    };
  }
};

// --------------------- FONCTION POUR AFFICHER LA METEO EN FCT DE LA LAT & LNG ------------
function afficher_meteo_lat_lng( sessionId, context, entities, lat, lng ) {
  // il faut executer une requete avec Lat,lng pour la méteo
  var quick =  [
      {
        "content_type":"text",
        "title":"Retour accueil",
        "payload": "RETOUR_ACCUEIL"
      },
      {
        "content_type":"text",
        "title":"Au revoir",
        "payload": "Dire_aurevoir"
      },
    ];
  requestify.get("http://api.openweathermap.org/data/2.5/weather?APPID="+api_key_weather+"&lat="+lat+"&lon="+lng, {} ).then( function( response )  {
      var body = JSON.parse(response.body);
      console.log('temperature'+body.main.temp);
      var temperature = parseInt(body.main.temp);
      var tempC = Math.round(temperature - 273.15);
      actions.envoyer_message_text( sessionId, context, entities, "Il fait "+tempC+"°C aujourd'hui à "+entities.location[ 0 ].value).then(function() {
        actions.envoyer_message_quickreplies(sessionId, context, entities, "Que souhaitez-vous faire maintenant ?", quick);
      })
    });
}
// --------------------- LE SERVEUR WEB ------------
const wit = new Wit( {
  accessToken: WIT_TOKEN,
  actions,
  logger: new log.Logger( log.INFO )
} );
const app = express();
app.use(( {
    method,
    url
  }, rsp, next ) => {
    rsp.on( 'finish', () => {
      console.log( `${rsp.statusCode} ${method} ${url}` );
    } );
    next();
});
app.use( bodyParser.json( {
  verify: verifyRequestSignature
} ) );
// ------------------------- LE WEBHOOK / hub.verify_token à CONFIGURER AVEC LE MEME MOT DE PASSE QUE FB_VERIFY_TOKEN ------------------------
app.get( '/webhook', ( req, res ) => {
  if ( req.query[ 'hub.mode' ] === 'subscribe' && req.query[
      'hub.verify_token' ] === "xxxx" ) { // remplir ici à la place de xxxx le meme mot de passe que FB_VERIFY_TOKEN
    res.send( req.query[ 'hub.challenge' ] );
  } else {
    res.sendStatus( 400 );
  }
} );
// ------------------------- LE WEBHOOK / GESTION DES EVENEMENTS ------------------------
app.post( '/webhook', ( req, res ) => {
  const data = req.body;
  if ( data.object === 'page' ) {
    data.entry.forEach( entry => {
      entry.messaging.forEach( event => {
        if ( event.message && !event.message.is_echo ) {
          var sender = event.sender.id;
          var sessionId = findOrCreateSession( sender );
          var {
            text,
            attachments,
            quick_reply
          } = event.message;

          function hasValue( obj, key ) {
            return obj.hasOwnProperty( key );
          }
          console.log(JSON.stringify(event.message));
          // -------------------------- MESSAGE IMAGE OU GEOLOCALISATION ----------------------------------
          if (event.message.attachments != null  && typeof event.message.attachments[0] != 'undefined') {
              // envoyer à Wit.ai ici
              wit.message( attachments[0].payload.coordinates.lat+","+attachments[0].payload.coordinates.long, sessions[ sessionId ]
                  .context )
                .then( ( {
                  entities
                } ) => {
                afficher_meteo_lat_lng( sessionId, sessions[ sessionId ].context, entities, attachments[0].payload.coordinates.lat, attachments[0].payload.coordinates.long);

                } )
                .catch( console.error );
					}
          // --------------------------- MESSAGE QUICK_REPLIES --------------------
					else if ( hasValue( event.message, "text" ) && hasValue(event.message, "quick_reply" ) ) {
            // envoyer à Wit.ai ici
            wit.message( quick_reply.payload, sessions[ sessionId ].context )
              .then( ( {
                entities
              } ) => {
                choisir_prochaine_action( sessionId, sessions[
                  sessionId ].context, entities );
                console.log( 'Yay, on a une response de Wit.ai : ' + JSON.stringify(
                  entities ) );
              } )
              .catch( console.error );
          }
          // ----------------------------- MESSAGE TEXT ---------------------------
          else if ( hasValue( event.message, "text" ) ) {
              // envoyer à Wit.ai ici
              wit.message( text, sessions[ sessionId ].context )
                .then( ( {
                  entities
                } ) => {
                  choisir_prochaine_action( sessionId, sessions[
                    sessionId ].context, entities );
                  console.log( 'Yay, on a une response de Wit.ai : ' + JSON.stringify(
                    entities ) );
                } )
                .catch( console.error );
          }
          // ----------------------------------------------------------------------------
          else {
              // envoyer à Wit.ai ici
          }
        }
        // ----------------------------------------------------------------------------
        else if ( event.postback && event.postback.payload ) {
          var sender = event.sender.id;
          var sessionId = findOrCreateSession( sender );
            // envoyer à Wit.ai ici
            wit.message( event.postback.payload, sessions[ sessionId ].context )
              .then( ( {
                entities
              } ) => {
                choisir_prochaine_action( sessionId, sessions[
                  sessionId ].context, entities );
                console.log( 'Yay, on a une response de Wit.ai : ' + JSON.stringify(
                  entities ) );
              } )
              .catch( console.error );

          }
        // ----------------------------------------------------------------------------
        else {
          console.log( 'received event : ', JSON.stringify( event ) );
        }
      } );
    } );
  }
  res.sendStatus( 200 );
} );
// ----------------- VERIFICATION SIGNATURE -----------------------
function verifyRequestSignature( req, res, buf ) {
  var signature = req.headers[ "x-hub-signature" ];
  if ( !signature ) {
    console.error( "Couldn't validate the signature." );
  } else {
    var elements = signature.split( '=' );
    var method = elements[ 0 ];
    var signatureHash = elements[ 1 ];
    var expectedHash = crypto.createHmac( 'sha1', FB_APP_SECRET ).update( buf )
      .digest( 'hex' );
    if ( signatureHash != expectedHash ) {
      throw new Error( "Couldn't validate the request signature." );
    }
  }
}
app.listen( PORT );
console.log( 'Listening on :' + PORT + '...' );
