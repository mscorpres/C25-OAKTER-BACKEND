const QRCode = require("qrcode");

exports.pdfTemplate = async function (data) {
  let string = "";

  for (let i = 0; i < data.length; i++) {
    let qrData = JSON.stringify(data[i]);
    let img = await QRCode.toDataURL(qrData);

    string += `
      <div class="item">
        <div class="content">
          <div class="info">
            <div class="info-row">
              <p class="label">Assets code:</p>
              <p>${data[i]["Assets code"]}</p>
            </div>
            <div class="info-row">
              <p class="label">Invoice date:</p>
              <p>${data[i]["Invoice date"]}</p>
            </div>
            <div class="info-row">
              <p class="label">Put to Use:</p>
              <p>${data[i]["Put to Use"]}</p>
            </div>
          </div>
          <div class="qrcode">
            <img src='${img}' alt="qrcode" />
          </div>
        </div>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Document</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: sans-serif;
        font-size: 10px;
      }
      .item {
        padding: 3px;
        border: 1px solid black;
        border-radius: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        max-width: 250px;
        page-break-inside: avoid;
        margin-bottom: 10px; /* Added space between items */
      }
      .content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
      }
      .info {
        display: flex;
        flex-direction: column;
        gap: 0px;
      }
      .info-row {
        display: flex;
        gap: 4px;
      }
      .label {
        font-weight: 600;
      }
      .qrcode {
        height: 50px;
        width: 50px;
      }
      .qrcode img {
        height: 100%;
        width: 100%;
      }
    </style>
  </head>
  <body>
    ${string}
  </body>
</html>
  `;
}
