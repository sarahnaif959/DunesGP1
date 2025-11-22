// netlify/functions/review.js
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;

// نخلي الـ client ثابت عشان ما نفتح اتصال جديد كل مرة
let client;
let collection;

async function getCollection() {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();

    // هنا اسم الداتا بيس والـ collection
    const db = client.db("EducationApp");       // تقدرين تغيرينه إذا اسم DB غير
    collection = db.collection("reviews");      // اسم الـ collection اللي تبين تخزين فيه
  }
  return collection;
}

exports.handler = async (event) => {
  // CORS للـ OPTIONS (preflight)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: "Method Not Allowed",
    };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const { index, file1, file2, label, note } = data;

    const col = await getCollection();

    // upsert على حسب الـ index
    await col.updateOne(
      { index },
      {
        $set: {
          index,
          file1,
          file2,
          label,
          note,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("Netlify function error:", err);

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};