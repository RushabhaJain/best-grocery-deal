const puppeteer = require('puppeteer-core');
const { OpenAI } = require('openai');
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function delay(timeInMS) {
    return new Promise((resolve) => setTimeout(resolve, timeInMS));
}

async function searchProduct(productName, pincode) {
  const stores = [
    { name: 'Flipkart Supermart', url: 'https://www.flipkart.com/search?marketplace=GROCERY&q=' },
    { name: 'Amazon Fresh', url: 'https://www.amazon.in/s?i=nowstore&k=' },
    { name: 'D Mart', url: 'https://www.dmart.in/search?searchTerm=' },
    { name: 'Jio Mart', url: 'https://www.jiomart.com/search/' }
  ];

  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  const allProducts = [];

  const productsPromises = stores.map(async (store) => {
    const page = await browser.newPage();
    // Set a larger viewport to ensure more content is visible
    await page.setViewport({
      width: 1080,
      height: 720,
      deviceScaleFactor: 2,
    });
    await page.goto(`${store.url}${encodeURIComponent(productName)}`);
    await page.waitForSelector('body');
    await page.keyboard.type("411057");
    await page.keyboard.press("Enter");
    await delay(5000); // Wait to add checking for availability

    // Take a full page screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const products = await analyzeScreenshot(store.name, productName, screenshot);

    await page.close();
    return products;
  })

  const productsListList = await Promise.all(productsPromises);
  for (const productList of  productsListList) {
    allProducts.push(...productList);
  }

  await browser.close();
  return allProducts
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);
}

async function analyzeScreenshot(storeName, query, screenshot) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { 
            type: "text", 
            text: `
                Analyze this image from ${storeName} and extract only the products that are visible in the image. 
                Focus on products that closely match the search query '${query}', considering both the product name and quantity.
                Provide the top 3 best deals for the relevant products.
                Respond in JSON format with an array of objects, each containing 'store', 'name', 'price', and 'quantity' properties. 
                The 'price' property should only contain numbers and make sure 'name' property has the full name of the product.
                Ensure all extracted information is directly from the image. 
                Exclude any products that are out of stock or not clearly visible. 
                Only provide the JSON in your response, with no additional text.
                If the search query has the brand name specify consider only those products while finding the best deal.
            `
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } }
        ]
      }
    ],
    max_tokens: 300
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('No content in OpenAI response');
  }
  const jsonContent = content.replace('```json', '').replace('```', '').trim();

  const products = JSON.parse(jsonContent).map((item) => ({
    name: item.name,
    price: item.price,
    store: storeName
  }));

  return products;
}

async function findCheapestProducts(productName) {
  return await searchProduct(productName, "416115");
}

(async () => {
    console.log("Finding your data...");
    const chepestProduct = await findCheapestProducts("amul ghee 500ml");
    console.log("Chepest product: ", chepestProduct);
})();



