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
    let index = 0;
    for (var ind in games) {
        if (!games[ind].success || games[ind].data.type != 'game') continue;
        const game = processGame(games[ind]);

        game.localimage = `${game.id}.jpg`;
        
        let str = '';
        index++;

        images.push({
            name: game.localimage,
            url: game.image
        });

        for (var key in game) {
            if (str!='') str+='\t';
            str += sanitize(`${game[key]}`);
        }
        console.log(`Parsed ${index} of ${games.length} titles.`);
        if (tsv == '') {
            let tempStr= '';
            for (var key in game) {
                if (tempStr!='') tempStr+='\t';
                tempStr += key;
            }
            tsv = tempStr;
        }
        tsv += '\n' + str;
    }
    console.log(`Outputting steam store as TSV file...`);
    fs.writeFile(`${wd}/steamstore.tsv`, tsv, function (err) {
    if (err) {
        return console.log(err);
    }
    console.log(`Steam store TSV export available at ${wd}/steamstore.tsv`);
    });
    console.log(`Downloading images...`);
    // downloadImages(images);
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
            console.log(` ! Image ${index} of ${images.length} failed to download.`);
            if (err.code == 'ENOTFOUND') {
                console.log('Server returned 404');
                
            } else {
                console.log('Unknown error occurred');
            }
            return;
        });
        file.on('error', (err) => {
            fs.unlink(dest);
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

const sanitize = (str) => {
    if (!str) return '';
    while (str.indexOf('\r')>=0) {
        str = str.replace('\r','');
    }
    while (str.indexOf('\n')>=0) {
        str = str.replace('\n','');
    }
    while (str.indexOf('\t')>=0) {
        str = str.replace('\t',' ');
    }
    while (str.indexOf('<strong>*</strong>')>=0) {
        str = str.replace('<strong>*</strong>','');
    }
    return str;
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
    const joinDeep = (arr, key) => {
        let str = '';
        for (var i in arr) {
            const val = arr[i][key];
            if (str!='') str+=',';
            str+=val;
        }
        return str;
    }
    return {
        name: sanitize(game['query_appname']),
        id: game['query_appid'],
        // about: data['about_the_game'] ? data['about_the_game'] : '',
        image: data['header_image'],
        isFree: data['is_free'],
        metacritic: data['metacritic'] ? data['metacritic']['score'] : '',
        developers: data['developers'] ? data['developers'].join(',') : '',
        genres: data['genres'] ? joinDeep(data['genres'],'description') : '',
        platforms: truekeyStr(data['platforms']),
        releasedate: data['release_date'] ? data['release_date']['date'] : 'TBD',
        languages: sanitize(data['supported_languages']),
        type: data['type'],
        price: data['price_overview'] ? data['price_overview']['final'] / 100 : 'TBD',
    };
}