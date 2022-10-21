let user_name = "";
(async function () {
    async function main() {
        let localStream;
        const socket = io.connect(window.location.origin);
        try {

            // Request access to the user's microphone and camera.
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
        } catch {
            alert(
                "No microphone found. Please activate your microphone and refresh the page."
            );
            return;
        }

        initRoom(socket);
        setupRemoteConn(socket);
        setupRealtimeTranscription(socket);
    }

    function setupRealtimeTranscription(socket) {
        const sampleRate = 16000;

        // Configure the recorder. The "Recorder" value is loaded in `index.html`
        // with the <script src="/js/recorder.min.js"> tag.
        const recorder = new Recorder({
            encoderPath: "/js/encoderWorker.min.js",
            leaveStreamOpen: true,
            numberOfChannels: 1,

            // OPUS options
            encoderSampleRate: sampleRate,
            streamPages: true,
            maxBuffersPerPage: 1,
        });

        /** We must forward the very first audio packet from the client because
         * it contains some header data needed for audio decoding.
         *
         * Thus, we must wait for the server to be ready before we start recording.
         */
        socket.on("can-open-mic", () => {
            recorder.start();
        });

        /** We forward our audio stream to the server. */
        recorder.ondataavailable = (e) => {
            socket.emit("microphone-stream", e.buffer);
        };
    }

    /**
     * Sets up the needed subscriptions on the socket to display
     * the remote video in remoteVideoNode.
     *
     * The websocket is NOT used to forward the video stream; it only forwards data to
     * the peer to establish a peer-to-peer connection through which the video and
     * audio streams will be transferred.
     *
     * @param {SocketIOClient.Socket} socket
     * This socket has to be "room initialized" with a call like `initRoom(socket)`.
     */
    function setupRemoteConn(socket) {
        /**
         * Will be used to track all the peer-to-peer
         * connections we'll have with other clients.
         * @type {Map<string, RTCPeerConnection>}
         */
        const allPeerConnections = new Map();


        socket.on("user-joined", (peerSocketId) => {
            // This function is executed by Alice.
            const peerConnection = createAndSetupPeerConnection(
                peerSocketId,
                socket,
                allPeerConnections
            );

            peerConnection.onnegotiationneeded = async () => {
                const sessionDescription = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(sessionDescription);
            };
        });


        /**
         * An ICE candidate describes what video/audio format can be
         * used. We just must forward these candidates to the corresponding
         * peer connection, which will take care of comparing this
         * candidate with what it can handle.
         *
         * @param {string} peerSocketId
         * @param {RTCIceCandidateInit} candidate
         */
        socket.on("ice-candidate", (peerSocketId, candidate) => {
            // This function is executed by Alice & Bob.
            allPeerConnections
                .get(peerSocketId)
                .addIceCandidate(new RTCIceCandidate(candidate))
                .catch((e) => console.error(e));
        });

        /** A client in the root has left, we close the corresponding
         * connection.
         *
         * @param {string} peerSocketId
         */
        socket.on("bye", (peerSocketId) => {
            // This function is executed by Alice or Bob.
            allPeerConnections.get(peerSocketId)?.close();
            allPeerConnections.delete(peerSocketId);
        });
    }

    function initRoom(socket) {
        /**
         * The room ID is specified in the path. We expect something like `/{roomId}`.
         *
         * In case there is no room ID in the URL, we generate a random one
         * and update the URL in the navigation bar (without adding
         * a new entry in the history).
         */
        // const user_name = document.getElementById("username").value;
        const roomRequested = location.pathname.substring(1);
        const room = roomRequested == "" ? 'smartmom' : roomRequested;
        
        socket.emit("join", room, user_name);
    }

    /**
     * @returns {string} */
    // function randomId() {
    //     var characters =
    //         "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    //     var result = "";
    //     for (var i = 0; i < 10; i++) {
    //         result += characters.charAt(
    //             Math.floor(Math.random() * characters.length)
    //         );
    //     }
    //     return result;
    // }

    /**
     * Create a RTC peer connection and:
     * - add this connection to `allPeerConnections`
     * - add the local stream as outgoing tracks to the peer connection
     *   so the local stream can be sent to the peer
     * - conversely, bind incoming tracks to remoteVideoNode.srcObject,
     *   so we can see the peer's stream
     * - forward ICE candidates to the peer through the socket. This is
     *   required by the RTC protocol to make both clients agree on what
     *   video/audio format and quality to use.
     *
     * @param {string} peerSocketId
     * @param {SocketIOClient.Socket} socket
     * @param {Map<string, RTCPeerConnection>} allPeerConnections
     * @returns {RTCPeerConnection} */
    function createAndSetupPeerConnection(peerSocketId, socket, allPeerConnections) {
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                {
                    urls: ["stun:stun.l.google.com:19302"],
                },
            ],
        });
        allPeerConnections.set(peerSocketId, peerConnection);

        //   localStream
        //     .getTracks()
        //     .forEach((track) => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("ice-candidate", peerSocketId, event.candidate);
            }
        };

        //   peerConnection.ontrack = (event) => {
        //     // remoteVideoNode.srcObject = event.streams[0];
        //   };

        return peerConnection;
    }
    const button = document.getElementById("enter-room");
    const login_div = document.getElementById("container-main");
    button.addEventListener("click", () => {
        if(document.getElementById("username").value === ""){
            alert("Please enter your name");
        }else{
            console.log(document.getElementById("username").value);
            user_name = document.getElementById("username").value;
            main();
            login_div.innerHTML = "";
            login_div.innerHTML = `
            <div class="recorder-container">
                <div class="outer"></div>
                <div class="outer-2"></div>
                <div class="icon-microphone"><img src="mic.png" alt="R" /></div>
            </div>
            `;
        }
    });
    // main();
})();
