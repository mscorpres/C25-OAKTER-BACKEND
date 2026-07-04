const onlineUsers = new Map();

module.exports = function(io) {
require("./socketController")(io);     
  require("./privateChatController")(io, onlineUsers);
};
