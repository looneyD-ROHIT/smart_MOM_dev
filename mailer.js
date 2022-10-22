const nodemailer = require('nodemailer')
require('dotenv').config()
//setting up nodemailer
var transporter = nodemailer.createTransport({
    service : "hotmail",
        auth : {
            user : process.env.USER,
            pass : process.env.PASSWORD
        }
  });

//setting up mailoptions
let mailoptions = {
    from: 'strivers1729@outlook.com',
    to: 'swapnilchatterjee.work@gmail.com',
    subject: 'TEST EMAIL',
    attachments: [
        {
            filename: 'Transcript.txt',
            path: __dirname + '\\trans.txt'
        }
    ],
    text: 'NODE MAILING TEMPLATE'
}

//sending email
transporter.sendMail(mailoptions, function(err,data){
    if(err){
        console.log('ERROR OCCURED', err);
    }
    else{
        console.log('SUCCESSFULL');
    }
});