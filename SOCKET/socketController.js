module.exports = function (io) {
    io.on("connection", (socket) => {
        console.log("🔌 Socket connected:", socket.id);

        socket.on("client_msg", (data) => {
            console.log("Client says:", data);
            io.emit("server_msg", "Server received: " + data);
        });

        socket.on("disconnect", () => {
            console.log("❌ Socket disconnected:", socket.id);
        });
    });
};
