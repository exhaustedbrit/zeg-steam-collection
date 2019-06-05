const http = require('http');
const fs = require('fs');
const targz = require('targz');

const database = 'http://s3.amazonaws.com/public-service/steam-data.tar.gz';
const wd = process.cwd();
const dbFile = `${wd}/steam-data.tar.gz`;

const downloadDB = (cb) => {
    var dest = dbFile;
    var file = fs.createWriteStream(dest);
    var request = http.get(database, function(response) {
        response.pipe(file);
            file.on('finish', function() {
            file.close(cb);
        });
    }).on('error', function(err) {
        fs.unlink(dest);
        if (cb) cb(err.message);
    });
}

const extractDB = () => {
    fs.exists(`${wd}/steam-data`, (exists) => {
        if (exists) {
            console.log("Database extraction already complete.");
            app();
        } else {
            console.log("Extracting steam database, this may take a while...");
            targz.decompress({
                src: dbFile,
                dest: `${wd}/steam-data`,
            }, function(err){
                if (err) {
                    console.log(err);
                } else {
                    console.log("Database extraction complete.");
                }
            });
        }
    })
};

fs.exists(dbFile, (exists) => {
    if (exists) {
        console.log('Steam DB already downloaded.');
        extractDB();
    } else {
        console.log('Downloading Steam database, please wait...');
        downloadDB((msg) => {
            if (msg) {
                console.log(msg);
            } else {
                console.log('Download complete.');
                extractDB();
            }
        });
    }
})

const state = {};

const app = () => {
    if (!state.data) {
        state.data = [];
        console.log('Reading serialized game data...');
        const raw = fs.readFileSync(`${wd}/steam-data/games.json`);
        let buffer = null;
        let last = 0;
        console.log('Loading steam data into memory...');
        raw.forEach((d, i) => {
            if (d == 10) {
                const size = i - last;
                const slice = raw.slice(last, i);
                last = i;
                state.data.push(JSON.parse(slice));
            }
        });
        console.log(`Identified ${state.data.length} titles.`);
    }
    console.log(`Processing steam store data...`);
    const games = state.data;
    let tsv = '';
    const images = [];
    for (var ind in games) {
        if (!games[ind].success) continue;
        const game = processGame(games[ind]);

        game.localimage = `${game.id}.jpg`;
        
        let str = '';

        images.push({
            name: game.localimage,
            url: game.image
        });

        for (var key in game) {
            if (str!='') str+='\t';
            str += game[key];
        }
        if (tsv == '') {
            let tempStr= '';
            for (var key in game) {
                if (tempStr!='') tempStr+='\t';
                tempStr += key;
            }
            tsv = tempStr;
        }
        tsv += '\r\n' + str;
    }
    console.log(`Outputting steam store as TSV file...`);
    fs.writeFile(`${wd}/steamstore.tsv`, tsv, function (err) {
    if (err) {
        return console.log(err);
    }
    console.log(`Steam store TSV export available at ${wd}/steamstore.tsv`);
    });
    console.log(`Downloading images...`);
    downloadImages(images);
};

const downloadImages = (images) => {
    let index = 0;
    const processQueue = () => {
        if (index >= images.length) {
            console.log(`Images successfully downloaded`);
            return;
        }
        const image = images[index];
        index++;
        var dest = `${wd}/images.nosync/${image.name}`;
        if (fs.existsSync(dest)) processQueue();
        var file = fs.createWriteStream(dest);
        var request = http.get(image.url, function(response) {
            response.pipe(file);
            file.on('finish', function() {
                console.log(`Image ${index} of ${images.length} downloaded successfully.`);
                file.close(() => {
                    processQueue();
                });
            });
        }).on('error', function(err) {
            fs.unlink(dest);
            console.log(` ! Image ${index} of ${images.length} failed to download.`);
            processQueue();
        });
    };
    // Check if images directory exists, if not create it then process.
    fs.exists(`${wd}/images.nosync/`, (exists) => {
        if (!exists) {
            fs.mkdirSync(`${wd}/images.nosync/`);
        }
        processQueue();
    });
}

const processGame = (game) => {
    const data = game.data;
    const truekeyStr = (obj) => {
        let str = '';
        for (var key in obj) {
            if (obj[key]) {
                if (str!='') str+=',';
                str += key;
            }
        }
        return str;
    }
    return {
        name: game['query_appname'],
        id: game['query_appid'],
        // about: data['about_the_game'] ? data['about_the_game'] : '',
        image: data['header_image'],
        isFree: data['is_free'],
        metacritic: data['metacritic'] ? data['metacritic']['score'] : '',
        developers: data['developers'] ? data['developers'].join(',') : '',
        genres: data['genres'] ? data['genres'].join(',') : '',
        platforms: truekeyStr(data['platforms']),
        releasedate: data['release_date'] ? data['release_date']['date'] : 'TBD',
        languages: data['supported_languages'],
        type: data['type'],
        price: data['price_overview'] ? data['price_overview']['final'] / 100 : 'TBD',
    };
}