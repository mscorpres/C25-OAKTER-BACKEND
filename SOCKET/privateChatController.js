module.exports = function (io, onlineUsers) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register_user", (userID) => {
      onlineUsers.set(userID, socket.id);
      console.log("Registered user:", userID);
    });

    socket.on("private_message", ({ toUserID, message, fromUserID }) => {
      const targetSocket = onlineUsers.get(toUserID);
      if (targetSocket) {
        io.to(targetSocket).emit("receive_private_message", {
          fromUserID,
          message,
        });
      }
    });

    socket.on("typing", ({ fromUserID, toUserID }) => {
      const targetSocket = onlineUsers.get(toUserID);
      if (targetSocket) io.to(targetSocket).emit("typing", { fromUserID });
    });

    socket.on(
      "private_message",
      ({ fromUserID, toUserID, message, type, fileName }) => {
        const targetSocket = onlineUsers.get(toUserID);
        if (targetSocket) {
          io.to(targetSocket).emit("receive_private_message", {
            fromUserID,
            message,
            type,
            fileName,
          });
        }
      }
    );

    socket.on("disconnect", () => {
      for (let [userID, sID] of onlineUsers.entries()) {
        if (sID === socket.id) onlineUsers.delete(userID);
      }
      console.log("User disconnected:", socket.id);
    });
  });
};
