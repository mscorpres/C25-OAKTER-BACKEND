exports.sell_print = (data, parts) => {
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
        font-size: 13px;
        font-family: sans-serif;
      }
      .container {
        width: 100vw;
        padding: 10px;
      }
      .innerContainer {
        width: 100%;
        border: 1px solid black;
      }
      table {
        border-collapse: collapse;
      }

      th,
      td {
        border: 1px solid black;
        border-collapse: collapse;
      }
      table {
        border-bottom: 0;
      }
      td {
        padding: 5px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="innerContainer">
        <!-- first sections -->
        <div style="display: flex">
          <!-- sender -->
          <div style="border-right: 1px solid black; width: 30%; padding: 10px">
            <p>Sender</p>
            <h5>Riot Labz pvt Ltd</h5>
            <p>Head Office: D 57, Second Floor, Sector 6,</p>
            <p>Noida 201301 (U P), WH : A21 , Phase II ,</p>
            <p>Hosiery Complex,</p>
            <p>Noida - 201305</p>
            <p>Uttar Pradesh (09) ,India</p>
            <p>Ph No: 7575040506</p>
            <p>GSTIN:09AAHCR1005Q1Z4</p>
            <p>CIN:U29253DL2014PTC273460</p>
            <p>PAN: AAHCR1005Q</p>
          </div>
          <!-- invoice -->
          <div style="border-right: 1px solid black; width: 40%">
            <!-- invoice no -->
            <div
              style="
                width: 100%;
                border-bottom: 1px solid black;

                display: flex;
              "
            >
              <div
                style="
                  flex: 1;
                  padding: 5px;
                  font-size: 10px;
                  border-right: 1px solid black;
                "
              >
                <p>Invoice No:</p>
                <b>NA </b>
              </div>
              <div style="flex: 1; padding: 5px; font-size: 10px">
                <p>E-way bill No:</p>
                <b>NA </b>
              </div>
            </div>
            <div
              style="
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 10px;
              "
            >
              <p>Order No: ${data.so_id}</p>
              <p>Order Date: ${data.insert_dt}</p>
              <p>Customer Po No: NA</p>
              Customer PO Date: NA
              <p>Bar Code</p>
            </div>
          </div>
          <!-- invoice date -->
          <div style="width: 30%">
            <!-- invoice no -->
            <div
              style="
                flex: 1;
                padding: 5px;
                font-size: 10px;
                border-bottom: 1px solid black;
              "
            >
              <p>Invoice Date:</p>
              <b>-- </b>
            </div>
            <div style="padding: 10px">
              <p>Portal</p>
              <p>Support</p>
              <p>Payment Mode</p>
              <p>NA</p>
            </div>
          </div>
        </div>
        <!-- second sections -->
        <div style="display: flex; border-top: 1px solid black">
          <!-- Bill To -->
          <div style="border-right: 1px solid black; width: 30%; padding: 10px">
            <p>Bill To</p>
            <h5>${data.customer_name}</h5>
            <p>${data.customer_address}</p>
          </div>
          <!-- Ship To -->
          <div style="border-right: 1px solid black; width: 40%; padding: 10px">
            <p>Ship To</p>
            <h5>${data.customer_name}</h5>
            <p>${data.shipping_address}</p>
          </div>
          <!-- dispatch Through -->
          <div style="width: 30%; padding: 10px">
            <p>Dispatch Through</p>
            <h5>SELF</h5>
            <p>${data.billing_address}</p>
          </div>
        </div>
        <!-- component table -->
        <table style="width: 100%">
          <thead style="width: 100%">
            <tr>
              <th style="border-left: 0">S. No.</th>
              <th>Description of Goods</th>
              <th>HSN/SAC</th>
              <th>Part No.</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Taxable Value (INR)</th>
              <th>CGST</th>
              <th>SGST</th>
              <th>IGST</th>
              <th style="border-right: 0">Amount</th>
            </tr>
          </thead>
          <tbody style="width: 100%">

            ${parts}
            <tr>
               <td style="border-left: 0"></td>
            <td>
              <b> Total </b>
            </td>
                <td></td>
                <td></td>
                <td>${data.sum_total_qty}</td>
                <td></td>
                <td>${data.sum_total_value}</td>
                <td>${data.sum_total_cgst}</td>
                <td>${data.sum_total_sgst}</td>
                <td>${data.sum_total_igst}</td>
                <td style="border-right: 0">${data.sum_total_amt}</td>
            </tr>

          </tbody>
        </table>
        <!-- third section -->
        <div style="display: flex">
          <div style="width: 50%; border-right: 1px solid black; padding: 10px">
            <h2>Narration</h2>
            <p>Amount Chargeable (in words)</p>
            <b>INR ${data.sum_total_amt_in_word} </b>
            <b>Tax is payable on reverse charge basis:No </b>
          </div>
          <div style="width: 50%; display: flex">
            <div style="flex: 2; border-right: 1px solid black; padding: 10px">
              <b>Bank Details:</b>
              <p>Name: HDFC Bank Ltd</p>
              <p>A/C No: 50200025114400</p>
              <p>IFSC Code: HDFC0001350</p>
              <p>Branch: Preet vihar, Delhi</p>
              <p>A/D Code: 05100052900009</p>
              <p>Swift Code: HDFCINBBDEL</p>
            </div>
            <div
              style="
                flex: 2;

                padding: 10px;
                display: flex;
                justify-content: center;
                align-items: center;
              "
            ></div>
          </div>
        </div>
        <!-- fourth section -->
        <div style="display: flex; border-top: 1px solid black">
          <div style="width: 50%; border-right: 1px solid black; padding: 10px">
            <h2>Declaration</h2>
            <p>
              1. We declare that this invoice shows the actual price of the
              goods described and that all particulars are true and correct. 2.
              All Disputes are subject to Uttar Pradesh (09) jurisdiction only
            </p>
          </div>
          <div
            style="
              width: 50%;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              padding: 10px;
            "
          >
            <p>For Riot Labz Pvt Ltd</p>
            <br />
            <br />
            <br />
            <br />
            <p>Authorised Signatory</p>
          </div>
        </div>
        <!-- fifth section -->
        <div
          style="
            padding: 10px;
            display: flex;
            gap: 10px;
            border-top: 1px solid black;
          "
        >
          <b>Prepared By:</b>
          <b>${data.insert_by}</b>
        </div>

        <!-- sixth section -->
        <div
          style="
            padding: 10px;
            display: flex;
            gap: 10px;
            justify-content: center;
            border-top: 1px solid black;
          "
        >
          <b>This is a computer generated invoice</b>
        </div>
      </div>
    </div>
  </body>
</html>

    `;
};
