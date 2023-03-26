// const XLSX = require("xlsx");
import XLSX from 'xlsx';

// const fs = require('fs');
import fs from 'fs';

// const nodemailer = require('nodemailer')
import nodemailer from 'nodemailer';

// require("dotenv").config();
import * as dotenv from 'dotenv';
dotenv.config();

// const cors = require('cors')
import cors from 'cors';

// const express = require("express");
import express from 'express';

// const http = require("http");
import http from 'http'

// const WebSocket = require("ws");
import WebSocket from 'ws';

// const { Deepgram } = require("@deepgram/sdk");
import { Deepgram } from '@deepgram/sdk';

import path from 'path';

import { URL } from 'url';


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
app.use(express.static("./public"));
app.get("*", function (req, res) {
    const t = new URL('.', import.meta.url).pathname
    // console.log('t='+t)
    // console.log(t + `/public/index.html`)
    res.sendFile(t + `/public/index.html`);
});

import * as socket from 'socket.io'
// const SocketIoServer = require("socket.io").Server;
const SocketIoServer = socket.Server;

// const Socket = require("socket.io").Socket;
const Socket = socket.Socket;

const io = new SocketIoServer(server);

io.sockets.on("connection", handle_connection);

// container of users
// user_name
// user_email
// joining_timestamp
let users = {};

let globalJSON = {};
let globalARR = [];

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
            fs.appendFile(`${room}_`+'mytranscript.txt', joinInfo, (err) => {
                if (err) throw err;
            })

            setupWebRTCSignaling(socket);
            setupRealtimeTranscription(socket, room);

            socket.on("disconnect", () => {
                // when user disconnects, we send the prepared transcript
                sendTranscript(users[socket.id], socket.id, room);

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
     * clients in the room.why
     */
    dgSocket.addListener("transcriptReceived", async (transcription) => {
        // let dummy = JSON.parse(transcription)?['channel']?['alternatives']?[0]?['transcript'];
        try {
            let dummyJS = JSON.parse(transcription);
            let dummy = "";
            if(dummyJS && dummyJS.channel && dummyJS.channel.alternatives && dummyJS.channel.alternatives[0]){
                dummy = dummyJS.channel.alternatives[0].transcript;
            }

            console.log(dummy);
            const user_name = users[socket.id]['user_name'];
            const tDate = (new Date()).toLocaleTimeString(undefined, { timeZone: 'Asia/Kolkata' });
            const final_transcript = `[${tDate}] ${user_name}: ${dummy}\n`;

            // forming the json type object to convert it into a spreadsheet
            let dict = {};
            dict[user_name] = dummy;
            let old_json = globalJSON[tDate];
            globalJSON[tDate] = Object.assign({}, old_json, dict);

        // forming the arr of objects



            if (dummy.length > 0) {
                await fs.appendFile(`${room}_`+'mytranscript.txt', final_transcript, (err) => {
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
    socket.on("ice-candidate", (id, message) => {
        socket.to(id).emit("ice-candidate", socket.id, message);
    });
}

const listener = server.listen(process.env.PORT, () =>
    console.log(`Server is running on port ${process.env.PORT}`)
);



//setting up nodemailer
function sendTranscript(user_data, socketid, room) {
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
        const allFileContents = fs.readFileSync(`${room}_`+'mytranscript.txt', 'utf-8');
        console.log(room);
        console.log(tempFileName)
        console.log(allFileContents)
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
        // writing the final trimmed data
        fs.writeFileSync(`${tempFileName}`, newDataToBeSent, (err) => {
            if (err) throw err;
        })


        // sending the json to excel data
        // let transARR = []
        // for (let key in globalJSON) {
        //     transARR.push(globalJSON[key]);
        // }

        // const workSheet = XLSX.utils.json_to_sheet(transARR);
        // const workBook = XLSX.utils.book_new();
        // XLSX.utils.book_append_sheet(workBook, workSheet, "transcript");
        // XLSX.write(workBook, { bookType: "xlsx", type: "buffer" });
        // XLSX.write(workBook, { bookType: "xlsx", type: "binary" });
        // XLSX.writeFile(workBook, "transcript.xlsx");
    } catch (e) {
        console.log('sendTranscript(error)/fileCreation(error): ' + e);
    }

    //setting up mailoptions
    let mailoptions = {
        from: 'strivers1729@outlook.com',
        to: `${user_data['user_email']}`,
        subject: 'TRANSCRIPT OF THE MEETING ',
        attachments: [
            {
                filename: 'transcript.txt',
                path: `./${tempFileName}`
            },
            // {
            //     filename: 'transcript.xlsx',
            //     path: `./transcript.xlsx`
            // }
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
                // fs.unlink(`${tempFileName}`, (err) => {
                //     if (err) throw err;
                //     console.log(`${tempFileName} was deleted`);
                // });
                // fs.unlink(`transcript.xlsx`, (err) => {
                //     if (err) throw err;
                //     console.log(`transcript.xlsx was deleted`);
                // })
                console.log('6')
            } catch (e) {
                console.log(`Error deleting file ${tempFileName} or transcript.xlsx`);
            }


            if (Object.keys(users).length == 0) {
                // all users left room, remove the content from global file
                try {

                    // fs.unlink(`${room}_`+'mytranscript.txt', (err) => {
                    //     if (err) throw err;
                    //     console.log(`${room}_mytranscript.txt was deleted`);
                    // });
                } catch (e) {
                    console.log(`Error deleting file ${room}_mytranscript.txt`);
                }
            }
        }
    });
}