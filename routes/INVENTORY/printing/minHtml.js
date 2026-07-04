

exports.minHtml = (data, parts, reverse_parts) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8" />
      <style>
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
              font-family: sans-serif;
              font-size: 10px;
          }
  
          body {
              padding-top: 20px;
              padding: 0 20px;
          }
  
          .table {
              border-collapse: collapse;
              border-right: 1px solid black;
              border-left: 1px solid black;
              width: 100%;
          }
  
          .section-2 td {
              padding: 5px 0;
          }
  
          .table th,
          .table td {
              border-collapse: collapse;
              padding: 5px;
              border: 1px solid black;
              width: 0.1%;
          }
  
          section {
              border-top: 1px solid black;
              border-right: 1px solid black;
              border-left: 1px solid black;
              width: 100%;
              padding: 5px 20px;
          }
  
          .middle-section {
              display: flex;
              align-items: center;
              justify-content: center;
          }
  
          .middle-section h3 {
              margin: 0 10px;
          }
  
          .heading {
              text-align: center;
              padding: 10px 0;
          }
  
          .section-1 {
              justify-content: space-between;
  
              align-items: center;
              display: flex;
          }
  
          .section-2 {
              width: 100%;
              display: flex;
              justify-content: space-between;
          }
  
          .section-2 .left {
              width: 50%;
          }
  
          .section-2 .left div,
          .section-2 .right div {
              display: grid;
              grid-template-columns: 1fr 1fr;
              margin: 5px 0;
          }
  
          .section-2 .left div h5,
          .section-2 .right div h5 {
              margin-right: 50px;
          }
  
          .section-2 .left div p {
              margin-left: -50px;
          }
  
          h5 {
              margin-right: 10px;
          }
  
          .page-number {
              display: flex;
              align-items: center;
              justify-content: center;
          }
  
          .section-3 {
              display: flex;
              padding-left: 200px;
              padding-top: 50px;
          }
  
          .section-3 span {
              margin: 0 50px;
          }
  
          .section-4 div {
              display: flex;
              align-items: center;
          }
  
          .section-4 h5 {
              margin: 10px 0;
          }
      </style>
  </head>
  <body>
      <section style="margin-top: 20px;">
          <h2 class="heading">RIOT LABZ PRIVATE LIMITED</h3>
      </section>
      <section class="section-1">
          <div>
              RIOT LABZ PRIATE LIMITED <br>
              Alwar, Rajasthan - 301030
          </div>
          <h5>GSTIN NO :08AAHCR1005Q1Z6</h5>
      </section>
      <section class="middle-section">
  
          <h3 class="heading">
              Material Receipt Note No.: ${data.min_txn_id}
          </h3>
          <h3>
              Date: ${data.inward_date}
          </h3>
      </section>
      <section class="section-2">
          <table>
              <tr>
                  <td style="white-space: nowrap;">
                      <h5>Delivery Addr : </h5>
                  </td>
                  <td>
                      <p>WH : B - 36 , Alwar ( Rajasthan)</p>
                  </td>
              </tr>
              <tr>
                  <td style="white-space: nowrap;">
                      <h5>GSTIN NO. :</h5>
                  </td>
                  <td>
                      <p>08AAHCR1005Q1Z6</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5 style="white-space: nowrap;">Branch : </h5>
                  </td>
                  <td>
                      <p>
                          ${data.branch}
                      </p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5 style="white-space: nowrap;">Supplier : </h5>
                  </td>
                  <td>
                      <p> ${data.vendor_name}<br /></p>
                  </td>
              </tr>
              <tr>
                  <td>
  
                  </td>
                  <td>
                      <p>${data.vendor_address} <br />${data.vendor_city} <br />${data.vendor_state}
                          <br />${data.vendor_pincode} <br /></p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5 style="white-space: nowrap;">GSTIN NO. : </h5>
                  </td>
                  <td>
                      <p>
                          ${data.vendor_gst}
                      </p>
                  </td>
              </tr>              
          </table>
          <table>
              <tr>
                  <td>
                      <h5>Code </h5>
                  </td>
                  <td>
                      <p> ${data.vendor_id}</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5>Vendor Inv. No :</h5>
                  </td>
                  <td>
                      <p>${data.material_in_invno}</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5>Ref MIN No. : </h5>  
                  </td>
                  <td>
                      <p>${data.min_txn_id}</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5>${data.material_in_type_label}</h5>
                  </td>
                  <td>
                      <p>${data.material_in_jwpono}</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5>${data.cost_center_label}</h5>
                  </td>
                  <td>
                      <p>${data.cost_center_value}</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5>Project :</h5>
                  </td>
                  <td>
                      <p>${data.project_name}</p>
                  </td>
              </tr>
              <tr>
                  <td>
                      <h5>Inv Number :</h5>
                  </td>
                  <td>
                      <p>${data.invoice_id}</p>
                  </td>
              </tr>
			  <tr>
                  <td>
                      <h5>Ack(s) ID :</h5>
                  </td>
                  <td>
                      <p>${data.acknowledgement_id}</p>
                  </td>
              </tr>
          </table>
      </section>
      <table class="table">
          <tr>
              <th>#</th>
              <th>PART</th>
              <th>ITEM / DESCRIPTION</th>
              <th>UOM</th>
              <th>QTY</th>
              <th>AMT</th>
              <th>Custom Duty</th>
              <th>Freight</th>
              <th>GST %</th>
              <th>TAX AMT</th>
              <th>TOTAL AMT</th>
              <th>IN LOCATION</th>
          </tr>
          <tr>${parts}</tr>
          <tr>
              <th colspan="4">TOTAL PRICE</th>
              <th>${data.totalQTY}</th>
              <th>${data.sum_norm_amt}</th>
              <th colspan="4" style="text-align:right">${data.sum_tax_amt}</th>
              <th colspan="2" style="text-align:left">${data.sum_total_amt}</th>
          </tr>          
          ${reverse_parts != "" ? `<tr><td colspan="10">Reversed Part</td></tr><tr>${reverse_parts}</tr>` : ""}
      </table>
      <section class="section-3">
          <span>Signature</span>
          <span>Date</span>
      </section>
      <section style="border-bottom: 1px solid black;" class="section-4">
          <div>
              <h5>REGD OFFICE :-</h5>Building No. B-36, Street: Matasya Industrial Area - Alwar (R.J) 301030
          </div>
          <div>
              <h5>Note :- </h5>
          </div>
      </section>
      <br/><br/>
      MIN Created By: ${data.min_done_by} <br />
      Print Date: ${moment().format("DD-MM-YYYY hh:mm:ss A")}
  </body>
  </html>
    `;
};
