const axios = require("axios");

const { apiUrl, getCredentials } = require("./fynGatewayConfig");

// GET ACCESS TOKEN
const getAccessToken = async (gstin) => {
  try {
    const credential = await getCredentials(gstin);
    if (credential.length == 0) {
      return res.status(403).send({ success: false, message: "Credentials not found!!!" });
    }
    const credential_data = function (column) {
      return credential.filter((item) => item.field_code == column)[0].value;
    };

    const res = await axios.post(`${apiUrl}authenticate`, "", {
      headers: {
        accept: "application/json",
        clientId: credential_data("34534531"),
        clientSecret: credential_data("12667523"),
        ref1: credential_data("76756064"),
      },
    });

    if (res.data.Status == 0) {
      throw new Error(res.data.ErrorDetails[0].ErrorMessage);
    }

    return res.data;

    //-------- SUCCESSFULL
    // {
    //     status: 1,
    //     data: {
    //       accessToken: '',
    //       expiresIn: 'Never'
    //     }
    //   }

    //-------- ERROR
    // { status: 0, errorMessage: 'Client Key is invalid.' }
  } catch (error) {
    throw new Error(error);
  }
};

// getAccessToken().then((data) => {
//   console.log(data);
// });

module.exports = { getAccessToken };
