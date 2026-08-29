const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const templatePath = path.join(
  process.cwd(),
  "helper",
  "mailTemplateYaml",
  "template.yaml"
);

const templates = yaml.load(
  fs.readFileSync(templatePath, "utf8")
);

exports.getMailTemplate = (templateName, data = {}) => {
  if (!templates[templateName]) {
    throw new Error(`Template '${templateName}' not found.`);
  }

  let html = templates[templateName].html;

  for (const key in data) {
    html = html.replace(
      new RegExp(`{{\\s*${key}\\s*}}`, "g"),
      data[key]
    );
  }

  return {
    subject: templates[templateName].subject,
    html,
  };
};