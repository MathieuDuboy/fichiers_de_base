'use strict'
// ----------------------- NOS MODULES -------------------------
const bodyParser = require( 'body-parser' );
const crypto = require( 'crypto' );
const express = require( 'express' );
const fetch = require( 'node-fetch' );
const request = require( 'request' );
const requestify = require( 'requestify' );
const firebase = require( 'firebase' );
const admin = require( "firebase-admin" );
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
firebase.initializeApp( {
	// a remplir
} );
admin.initializeApp( {
	credential: admin.credential.cert( {
		// a remplir
	} ),
	databaseURL: "" // saisir ici vos informations (infos sur session XX)
} );
// ----------------------- PARAMETRES DU SERVEUR -------------------------
const PORT = process.env.PORT || 5000;
// Wit.ai parameters
const WIT_TOKEN = ""; // saisir ici vos informations (infos sur session XX)
// Messenger API parameters
const FB_PAGE_TOKEN = ""; // saisir ici vos informations (infos sur session XX)
if ( !FB_PAGE_TOKEN ) {
	throw new Error( 'missing FB_PAGE_TOKEN' )
}
const FB_APP_SECRET = ""; // saisir ici vos informations (infos sur session XX)
if ( !FB_APP_SECRET ) {
	throw new Error( 'missing FB_APP_SECRET' )
}
let FB_VERIFY_TOKEN = ""; // saisir ici vos informations (infos sur session XX)
crypto.randomBytes( 8, ( err, buff ) => {
	if ( err ) throw err;
	FB_VERIFY_TOKEN = buff.toString( 'hex' );
	console.log( `/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"` );
} );
// ----------------------- FONCTION POUR VERIFIER UTILISATEUR OU CREER ----------------------------
var checkAndCreate = ( fbid, prenom, nom, genre ) => {
	var userz = firebase.database().ref().child( "accounts" ).orderByChild( "fbid" ).equalTo( fbid ).once( "value", function( snapshot ) {
		admin.auth().createCustomToken( fbid ).then( function( customToken ) {
			firebase.auth().signInWithCustomToken( customToken ).then( function() {
				//inserer notre compte
				var user2 = firebase.auth().currentUser;
				var keyid = firebase.database().ref().child( 'accounts' ).push();
				firebase.database().ref().child( 'accounts' ).child( keyid.key ).set( {
					fbid: fbid,
					prenom: prenom,
					nom: nom,
					genre: genre,
					date: new Date().toISOString()
				} ).catch( function( error2 ) {
					console.log( error2 );
				} );
			} ).catch( function( error ) {
				// Handle Errors here.
				var errorCode = error.code;
				var errorMessage = error.message;
			} );
		} ).catch( function( error3 ) {
			console.log( "Erreur : " + error3 );
		} );
	} );
};
// ------------------------ FONCTION DEMANDE INFORMATIONS USER -------------------------
var requestUserName = ( id ) => {
	var qs = 'access_token=' + encodeURIComponent( FB_PAGE_TOKEN );
	return fetch( 'https://graph.facebook.com/v2.8/' + encodeURIComponent( id ) + '?' + qs ).then( rsp => rsp.json() ).then( json => {
		if ( json.error && json.error.message ) {
			throw new Error( json.error.message );
		}
		return json;
	} );
};
// ------------------------- ENVOI MESSAGES SIMPLES ( Texte, images, boutons génériques, ...) ------------------------
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
			console.log( json.error.message + ' ' + json.error.type + ' ' + json.error.code + ' ' + json.error.error_subcode + ' ' + json.error.fbtrace_id );
		}
		return json;
	} );
};
// ----------------------------------------------------------------------------
const sessions = {};
// ------------------------ FONCTION DE CREATION DE SESSION ---------------------------
var findOrCreateSession = ( fbid ) => {
	let sessionId;
	Object.keys( sessions ).forEach( k => {
		if ( sessions[ k ].fbid === fbid ) {
			sessionId = k;
		}
	} );
	if ( !sessionId ) {
		sessionId = new Date().toISOString();
		sessions[ sessionId ] = {
			fbid: fbid,
			context: {}
		};
		requestUserName( fbid ).then( ( json ) => {
			sessions[ sessionId ].name = json.first_name;
			checkAndCreate( fbid, json.first_name, json.last_name, json.gender );
		} ).catch( ( err ) => {
			console.error( 'Oops! Il y a une erreur : ', err.stack || err );
		} );
	}
	return sessionId;
};
// ------------------------ FONCTION DE RECHERCHE D'ENTITES ---------------------------
var firstEntityValue = function( entities, entity ) {
		var val = entities && entities[ entity ] && Array.isArray( entities[ entity ] ) && entities[ entity ].length > 0 && entities[ entity ][ 0 ].value
		if ( !val ) {
			return null
		}
		return typeof val === 'object' ? val.value : val
	}
	// ------------------------ LISTE DE TOUTES VOS ACTIONS A EFFECTUER ---------------------------
var actions = {
	// fonctions genérales
};
// --------------------- CHOISIR LA PROCHAINE ACTION (LOGIQUE) EN FCT DES ENTITES OU INTENTIONS------------
function choisir_prochaine_action( sessionId, context, entities ) {
	// PAR DEFAUT : AUCUNE ENTITE DETECTEE
	if ( Object.keys( entities ).length === 0 && entities.constructor === Object ) {}
	// PAS DINTENTION
	if ( !entities.intent ) {}
	// IL Y A UNE INTENTION : FAISONS LE TRI
	else {}
};
// --------------------- LE SERVEUR WEB ------------
const wit = new Wit( {
	accessToken: WIT_TOKEN,
	actions,
	logger: new log.Logger( log.INFO )
} );
const app = express();
app.use( ( {
	method,
	url
}, rsp, next ) => {
	rsp.on( 'finish', () => {
		console.log( `${rsp.statusCode} ${method} ${url}` );
	} );
	next();
} );
app.use( bodyParser.json( {
	verify: verifyRequestSignature
} ) );
app.get( '/webhook', ( req, res ) => {
	if ( req.query[ 'hub.mode' ] === 'subscribe' && req.query[ 'hub.verify_token' ] === "" ) { // a remplir en étape XX
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
					console.log( JSON.stringify( event.message ) );
					// -------------------------- MESSAGE IMAGE OU GEOLOCALISATION ----------------------------------
					if ( event.message.attachments != null && typeof event.message.attachments[ 0 ] != 'undefined' ) {
						// envoyer à Wit.ai ici
					}
					// --------------------------- MESSAGE QUICK_REPLIES --------------------
					else if ( hasValue( event.message, "text" ) && hasValue( event.message, "quick_reply" ) ) {
						// envoyer à Wit.ai ici
					}
					// ----------------------------- MESSAGE TEXT ---------------------------
					else if ( hasValue( event.message, "text" ) ) {
						// envoyer à Wit.ai ici
					}
					// ----------------------------------------------------------------------------
					else {
						// envoyer à Wit.ai ici
					}
				} // event.message
				// ----------------------------------------------------------------------------
				else if ( event.postback && event.postback.payload ) {
					var sender = event.sender.id;
					var sessionId = findOrCreateSession( sender );
					// envoyer à Wit.ai ici
				}
				// ----------------------------------------------------------------------------
				else {
					console.log( 'received event autre', JSON.stringify( event ) );
				}
			} );
		} );
	}
	res.sendStatus( 200 );
} );
// -----------------VERIFICATION SIGNATURE -----------------------
function verifyRequestSignature( req, res, buf ) {
	var signature = req.headers[ "x-hub-signature" ];
	if ( !signature ) {
		// For testing, let's log an error. In production, you should throw an
		// error.
		console.error( "Couldn't validate the signature." );
	} else {
		var elements = signature.split( '=' );
		var method = elements[ 0 ];
		var signatureHash = elements[ 1 ];
		var expectedHash = crypto.createHmac( 'sha1', FB_APP_SECRET ).update( buf ).digest( 'hex' );
		if ( signatureHash != expectedHash ) {
			throw new Error( "Couldn't validate the request signature." );
		}
	}
}
app.listen( PORT );
console.log( 'Listening on :' + PORT + '...' );
