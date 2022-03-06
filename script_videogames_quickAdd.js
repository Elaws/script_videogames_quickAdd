const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

const API_URL = "https://api.igdb.com/v4/games";
const AUTH_URL = "https://id.twitch.tv/oauth2/token";
const GRANT_TYPE = "client_credentials";

const API_CLIENT_ID_OPTION ="IGDB API Client ID"
const API_CLIENT_SECRET_OPTION ="IGDB API Client secret" 

var userData = {igdbToken: ""};
var AUTH_TOKEN;

module.exports = {
  entry: start,
  settings: {
    name: "Videogames Script",
    author: "Elaws",
    options: {
      [API_CLIENT_ID_OPTION]: {
        type: "text",
        defaultValue: "",
        placeholder: "IGDB API Client ID",
      },
      [API_CLIENT_SECRET_OPTION]:{
        type: "text",
        defaultValue: "",
        placeholder: "IGDB API Client secret",
      },
    },
  },
};

let QuickAdd;
let Settings;
let savePath;

async function start(params, settings) {
	QuickAdd = params;
	Settings = settings;

	var relativePath = QuickAdd.app.vault.configDir;
	savePath = QuickAdd.obsidian.normalizePath(`${relativePath}/igdbToken.json`);

	// Retrieve saved token or create and save one (in Obsidian's system directory as igdbToken.json)
	// Token is generated from client ID and client secret, and lasts 2 months. 
	// Token is refreshed when request fails because of invalid token (every two months)
	await readAuthToken();

	const query = await QuickAdd.quickAddApi.inputPrompt(
	"Enter videogame title: "
	);
	if (!query) {
		notice("No query entered.");
		throw new Error("No query entered.");
	}

	const searchResults = await getByQuery(query);
	
	const selectedGame = await QuickAdd.quickAddApi.suggester(
		searchResults.map(formatTitleForSuggestion),
		searchResults
	);
	if (!selectedGame) {
		notice("No choice selected.");
		throw new Error("No choice selected.");
	}
	
	if(selectedGame.involved_companies)
	{
		var developer = (selectedGame.involved_companies).find(element => element.developer);
	}

	
	const isPlayed = await QuickAdd.quickAddApi.yesNoPrompt("Played ?");
	let myRating = "/10";
	let myRecommender = " ";
	let comment = " ";

	// If game already played, add a rating to it.
	if(isPlayed){
		myRating = await QuickAdd.quickAddApi.inputPrompt("Rating", null, "/10");
	}

	myRecommender = await QuickAdd.quickAddApi.inputPrompt("Recommender", null, " ");
	comment = await QuickAdd.quickAddApi.inputPrompt("Comment", null, " ");

	QuickAdd.variables = {
		...selectedGame,
		fileName: replaceIllegalFileNameCharactersInString(selectedGame.name),
		// Each genre comes in {ID, NAME} pair. Here, get rid of ID to keep NAME only.
		// POST request to IGDB in apiGet(query) uses IGDB API's expander syntax (see : https://api-docs.igdb.com/#expander)
		genresFormatted: `${selectedGame.genres ? formatList((selectedGame.genres).map(item => item.name)) : " "}`,
		gameModesFormatted: `${selectedGame.game_modes ? formatList((selectedGame.game_modes).map(item => item.name)) : " "}`,
		//Developer name and logo
		developerName: `${developer ? developer.company.name : " "}`,
		developerLogo: `${developer ? (developer.company.logo ? ("https:" + developer.company.logo.url).replace("thumb", "logo_med") : " ") : " "}`,
		// For possible image size options, see : https://api-docs.igdb.com/#images
		thumbnail: `${selectedGame.cover ? "https:" + (selectedGame.cover.url).replace("thumb", "cover_big") : " "}`,
		// Release date is given as UNIX timestamp.
		release: `${selectedGame.first_release_date ? (new Date((selectedGame.first_release_date*1000))).getFullYear() : " "}`,
		// Squares of different color to tag Obsidian's note, depending if game has already been played or not.
		tag: `${isPlayed ? "\u{0001F7E7}" : "\u{0001F7E5}"}`,
		// A short description of the game.
		storylineFormatted: `${selectedGame.storyline ? (selectedGame.storyline).replace(/\r?\n|\r/g, " ") : " "}`,
		rating: myRating,
		played: `${isPlayed ? "1" : "0"}`,
		// Who recommended the game ?
		recommender: myRecommender,
		// A short personal comment on the game.
		comment
	};
}

function formatTitleForSuggestion(resultItem) {
	return `${resultItem.name} (${
	(new Date((resultItem.first_release_date)*1000)).getFullYear()
	})`;
}

async function getByQuery(query) {

    const searchResults = await apiGet(query);

	if(searchResults.message)
    {
      await refreshAuthToken();
      return await getByQuery(query);
    }

    if (searchResults.length == 0) {	
      notice("No results found.");
      throw new Error("No results found.");
    }

    return searchResults;
}

function formatList(list) {
	if (list.length === 0 || list[0] == "N/A") return " ";
	if (list.length === 1) return `${list[0]}`;

	return list.map((item) => `\"${item.trim()}\"`).join(", ");
}

function replaceIllegalFileNameCharactersInString(string) {
	return string.replace(/[\\,#%&\{\}\/*<>$\":@.]*/g, "");
}

async function readAuthToken(){

	if(await QuickAdd.app.vault.adapter.exists(savePath))
	{ 
		userData = JSON.parse(await QuickAdd.app.vault.adapter.read(savePath));
		AUTH_TOKEN = userData.igdbToken;
	} 
	else {
		await refreshAuthToken();
	}
}

async function refreshAuthToken(){

	const authResults = await getAuthentified();

	if(!authResults.access_token){
		notice("Auth token refresh failed.");
    	throw new Error("Auth token refresh failed.");
	} else {
		AUTH_TOKEN = authResults.access_token;
		userData.igdbToken = authResults.access_token;
		await QuickAdd.app.vault.adapter.write(savePath, JSON.stringify(userData));
	}
}

async function getAuthentified() {
	let finalURL = new URL(AUTH_URL);

	finalURL.searchParams.append("client_id", Settings[API_CLIENT_ID_OPTION]);
	finalURL.searchParams.append("client_secret", Settings[API_CLIENT_SECRET_OPTION]);
	finalURL.searchParams.append("grant_type", GRANT_TYPE);
	
	const res = await request({
		url: finalURL.href,
		method: 'POST',
		cache: 'no-cache',
		headers: {
			'Content-Type': 'application/json'
		}	
	})
	return JSON.parse(res);
}

async function apiGet(query) {

	try {
		const res = await request({
			url: API_URL, 
			method: 'POST',
			cache: 'no-cache',
			headers: {
				'Client-ID': Settings[API_CLIENT_ID_OPTION],
				'Authorization': "Bearer " + AUTH_TOKEN 
			},
			// The understand syntax of request to IGDB API, read the following :
			// https://api-docs.igdb.com/#examples
			// https://api-docs.igdb.com/#game
			// https://api-docs.igdb.com/#expander
			body: "fields name, first_release_date, involved_companies.developer, involved_companies.company.name, involved_companies.company.logo.url, url, cover.url, genres.name, game_modes.name, storyline; search \"" + query + "\"; limit 15;"
		})
		
		return JSON.parse(res);
	} catch (error) {
		await refreshAuthToken();
		return await getByQuery(query);
	}
}