exports.bp = function (data, particulars) {
  return `
      <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Document</title>
    </head>
    <style>
      body {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: sans-serif;
        padding: 10px 20px;
      }
      table,
      tr,
      td,
      th {
        border: 1px solid black;
        border-collapse: collapse;
      }
      tr,
      td {
        padding: 10px;
      }
  
      table {
        width: 100%;
      }
      .first-div {
        width: 100%;
        display: flex;
        justify-content: flex-end;
      }
      .first-div p {
        display: flex;
        align-items: flex-end;
      }
      .first-div span {
        display: block;
        width: 100px;
        margin-left: 10px;
        border-bottom: 1px solid black;
      }
      .pay{
          
          width: 100%;
      }
      .second-div{
          width: 100%;
          display: flex;
          justify-content: space-between;
      }
      .third-div{
          display: flex;
          justify-content: space-between;
          width: 100%;
          margin: 5px 0;
      }
      .div{
          display: flex;
          flex-direction: row;
          align-items:center;
          /* background-color: red; */
          height: 30px;
      }
      .div p{
          /* margin-right: 80px; */
      }
      .div span{
          width: 100px;
          display: block;
          margin-top: 10px;
          border-bottom: 1px solid black;
      }
    </style>
    <body>
      <h2>PAYMENT VOUCHER</h2>
      <h3>Riot Labz Private Limited</h3>
    </body>
    <div class="first-div">
      <div>
        <p><b>Create Date: </b> <span>${data.create_date}</span></p>
        <p><b>Date: </b> <span>${data.effective_date}</span></p>
      </div>
    </div>
    <p class="pay""><b>Account:</b> ${data.account}</p>
    <table>
      <tr>
        <th>Particulars Code</th>
        <th>Particulars</th>
        <th>Debit</th>
        <th>Credit</th>
      </tr>
  
      ${particulars}
  
      <tr>
        <th></th>
        <th>Total</th>
        <th>${data.total_debit}</th>
        <th>${data.total_credit}</th>
      </tr>
  
    </table>
    <div class="second-div">
  <p>Bank Account: </p>
  <p>Cheque No.: </p>
    </div>
    <div class="third-div">
      <div class="div">
          <p>Prepared By: </p><span></span>
      </div>
      <div class="div">
          <p>Signature: </p><span></span>
      </div>
      <div class="div">
          <p>Date: </p><span></span>
      </div >
    </div>
    <div class="third-div">
      <div class="div">
          <p>Approved By: </p><span></span>
      </div>
      <div class="div">
          <p>Signature: </p><span></span>
      </div>
      <div class="div">
          <p>Date: </p><span></span>
      </div>
    </div>
    <div class="third-div">
      <div class="div">
          <p>Recorded By: </p><span></span>
      </div>
      <div class="div">
          <p>Signature: </p><span></span>
      </div>
      <div class="div">
          <p>Date: </p><span></span>
      </div>
    </div>
  </html>
      `;
};
