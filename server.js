/* The `dotenv` package allows us to load environment
 * variables from the `.env` file. Then, we can access them
 * with `process.env.ENV_VAR_NAME`.
 */

const fs = require('fs');
const nodemailer = require('nodemailer')
require("dotenv").config();
const cors = require('cors')
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { Deepgram } = require("@deepgram/sdk");

const DG_KEY = process.env.DG_KEY;

if (DG_KEY === undefined) {
    throw "You must define DG_KEY in your .env file";
}

const app = express();
let server = http.createServer(app);

/*
 * Basic configuration:
 * - we expose the `/public` folder as a "static" folder, so the
 *   browser can directly request the js and css files that it contains.
 * - we send the `/public/index.html` file when the browser requests
 *   any route.
 */
app.use(cors())
app.use(express.static(__dirname + "/public"));
app.get("*", function (req, res) {
    res.sendFile(`${__dirname}/public/index.html`);
});

const SocketIoServer = require("socket.io").Server;
const Socket = require("socket.io").Socket;
const io = new SocketIoServer(server);
io.sockets.on("connection", handle_connection);

// container of users
// user_name
// user_email
// joining_timestamp
let users = {};

// const MAX_CLIENTS = 2;
/**
 * This function will be called every time a client
 * opens a socket with the server. This is where we will define
 * what to do in reaction to messages sent by clients.
 * @param {Socket} socket */
function handle_connection(socket) {
    socket.on("join", (room, user_data) => {
        try {
            socket.join(room);
            // appending the joining time to the user_data
            user_data['joiningtime'] = (new Date()).toLocaleTimeString(undefined, { timeZone: 'Asia/Kolkata' });

            users[socket.id] = user_data;
            socket.broadcast.to(room).emit("user-joined", socket.id);

            const joinInfo = "[" + user_data['joiningtime'] + "] " + user_data.user_name + " joined.\n"

            // write to the file that the user joined the chat
            fs.appendFile('mytranscript.txt', joinInfo, (err) => {
                if (err) throw err;
            })

            setupWebRTCSignaling(socket);
            setupRealtimeTranscription(socket, room);

            socket.on("disconnect", () => {
                // when user disconnects, we send the prepared transcript
                sendTranscript(users[socket.id], socket.id);

                socket.broadcast.to(room).emit("bye", socket.id);
                // console.log('before: ' + Object.keys(users).length)
                delete users[socket.id];
                // console.log('after: ' + Object.keys(users).length)
            });
        } catch (e) {
            console.log('Inside handle_connection(error): ' + e);
        }
    });
}

/**
 * @param {Socket} socket
 * @param {string} room
 */
function setupRealtimeTranscription(socket, room) {
    /** The sampleRate must match what the client uses. */
    const sampleRate = 16000;

    const deepgram = new Deepgram(DG_KEY);

    const dgSocket = deepgram.transcription.live({
        punctuate: true,
        interim_results: false,
        language: 'en-IN'
    });

    /** We must receive the very first audio packet from the client because
     * it contains some header data needed for audio decoding.
     *
     * Thus, we send a message to the client when the socket to Deepgram is ready,
     * so the client knows it can start sending audio data.
     */
    dgSocket.addListener("open", () => socket.emit("can-open-mic"));

    /**
     * We forward the audio stream from the client's microphone to Deepgram's server.
     */
    socket.on("microphone-stream", (stream) => {
        if (dgSocket.getReadyState() === WebSocket.OPEN) {
            dgSocket.send(stream);
        }
    });

    /** On Deepgram's server message, we forward the response back to all the
     * clients in the room.
     */
    dgSocket.addListener("transcriptReceived", async (transcription) => {
        // io.to(room).emit("transcript-result", socket.id, transcription);
        // console.log('transcribed')
        // console.log(transcription)
        let dummy = JSON.parse(transcription)['channel']['alternatives'][0]['transcript'];
        console.log(dummy);
        const user_name = users[socket.id]['user_name'];
        const tDate = (new Date()).toLocaleTimeString(undefined, { timeZone: 'Asia/Kolkata' });
        const final_transcript = `[${tDate}] ${user_name}: ${dummy}\n`;
        try {
            if (dummy.length > 0) {
                fs.appendFile('mytranscript.txt', final_transcript, (err) => {
                    if (err) throw err;
                })
            }
        } catch (e) {
            console.log('Error Writing to file');
        }
    });

    /** We close the dsSocket when the client disconnects. */
    socket.on("disconnect", () => {
        if (dgSocket.getReadyState() === WebSocket.OPEN) {
            dgSocket.finish();
        }
    });
}

/**
 * Handle the WebRTC "signaling". This means we forward all the needed data from
 * Alice to Bob to establish a peer-to-peer connection. Once the peer-to-peer
 * connection is established, the video stream won't go through the server.
 *
 * @param {Socket} socket
 */
function setupWebRTCSignaling(socket) {
    // socket.on("video-offer", (id, message) => {
    //     socket.to(id).emit("video-offer", socket.id, message);
    // });
    // socket.on("video-answer", (id, message) => {
    //     socket.to(id).emit("video-answer", socket.id, message);
    // });
    socket.on("ice-candidate", (id, message) => {
        socket.to(id).emit("ice-candidate", socket.id, message);
    });
}

const listener = server.listen(process.env.PORT, () =>
    console.log(`Server is running on port ${process.env.PORT}`)
);



//setting up nodemailer
function sendTranscript(user_data, socketid) {
    // console.log(socketid);
    // console.log(__dirname)
    var transporter = nodemailer.createTransport({
        service: "hotmail",
        auth: {
            user: process.env.EMAILID,
            pass: process.env.PASSWORD
        }
    });

    // extracting the data to be sent from joining time to exit time
    const tempFileName = `${socketid}.txt`
    try {
        // entire file contents as a string
        const allFileContents = fs.readFileSync('mytranscript.txt', 'utf-8');
        // entire file contents line by line with one line in one array
        const lineByLineData = allFileContents.split(/\r?\n/);
        // string to be searched
        const toBeChecked = "[" + user_data.joiningtime + "] " + user_data.user_name + " joined."
        // first index of matched value
        // const firstIndex = lineByLineData.indexOf(toBeChecked);
        let firstIndex = -1;
        for (let i = 0; i < lineByLineData.length; i++) {
            if (toBeChecked == lineByLineData[i]) {
                firstIndex = i;
                break;
            }
        }
        // final trimmed data
        const newDataToBeSent = lineByLineData.slice(firstIndex).join('\n');

        console.log('1')
        fs.writeFileSync(`${tempFileName}`, newDataToBeSent, (err) => {
            if (err) throw err;
        })
        console.log('2')
    } catch (e) {
        console.log('sendTranscript(error)/fileCreation(error): ' + e);
    }

    //setting up mailoptions
    console.log('3')
    let mailoptions = {
        from: 'strivers1729@outlook.com',
        to: `${user_data['user_email']}`,
        subject: 'TRANSCRIPT OF THE MEETING ',
        attachments: [
            {
                filename: 'transcript.txt',
                path: __dirname + `/${tempFileName}`
            }
        ],
        text: `Hello ${user_data['user_name']}, here is your auto-generated minutes of the meeting attached below.`
    }
    console.log('4')

    //sending email
    transporter.sendMail(mailoptions, function (err, data) {
        if (err) {
            console.log('ERROR OCCURED', err);
            delete mailoptions['attachments'];
            transporter.sendMail(mailoptions, function (err, data) {
                if (err) {
                    console.log('ERROR OCCURED', err);
                } else {
                    console.log('Sent empty data');
                }
            });
        }
        else {
            console.log(`SUCCESSFULL, email sent to ${user_data['user_name']} at ${user_data['user_email']}`);

            // after-work: remove file contents
            // now delete the file of that respective user who left the chat
            try {

                console.log('5')
                fs.unlink(`${tempFileName}`, (err) => {
                    if (err) throw err;
                    console.log(`${tempFileName} was deleted`);
                });
                console.log('6')
            } catch (e) {
                console.log(`Error deleting file ${tempFileName}`);
            }


            if (Object.keys(users).length == 0) {
                // all users left room, remove the content from global file
                try {

                    fs.unlink('mytranscript.txt', (err) => {
                        if (err) throw err;
                        console.log('mytranscript.txt was deleted');
                    });
                } catch (e) {
                    console.log('Error deleting file mytranscript.txt');
                }
            }
        }
    });
}


// class Transcript {
//     constructor() {
//         // /** @type {Map<number, {words: string, is_final: boolean}>} */
//         this.chunks = new Map();
//     }

//     addServerAnswer(jsonFromServer) {
//         const words = JSON.parse(jsonFromServer).channel.alternatives[0]
//             .transcript;
//         if (words !== "") {
//             this.chunks.set(jsonFromServer.start, {
//                 words,
//                 // if "is_final" is true, we will never have future updates for this
//                 // audio chunk.
//                 is_final: jsonFromServer.is_final,
//             });
//         }
//     }

//     toHtml() {
//         const divNode = document.createElement("div");
//         divNode.className = "transcript-text";
//         [...this.chunks.entries()]
//             .sort((entryA, entryB) => entryA[0] - entryB[0])
//             .forEach((entry) => {
//                 const spanNode = document.createElement("span");
//                 spanNode.innerText = entry[1].words;
//                 spanNode.className = entry[1].is_final ? "final" : "interim";
//                 divNode.appendChild(spanNode);
//                 divNode.appendChild(document.createTextNode(" "));
//             });

//         return divNode;
//     }
// }