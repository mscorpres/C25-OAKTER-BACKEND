module.exports = {
	apps: [
		{
			name: "IMS API",
			script: "app.js",
			watch: ["./routes"],
			watch_delay: 500,
			instances: 2,
			exec_mode: "cluster",
			error_file: "./error.log",
			out_file: "./sql.log",
			log_type: "json",
			watch: false,
			time: true,
			log_date_format: "DD-MM-YYYY hh:mm:ss Z",
			ignore_watch: ["node_modules", "files", "uploads"],
		},
	],
};
