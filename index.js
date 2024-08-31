/* Costing: Each API Call search will take around 2 RS. */

const puppeteer = require('puppeteer-core');
const { OpenAI } = require('openai');
const dotenv = require("dotenv");

/*
For debugging

Save the base64 encoded screenshot to a file
//   const fs = require('fs');
//   const path = require('path');
*/

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

    // Configure browser launch options to use a new temporary user data directory
    const browserLaunchOptions = {
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    const browser = await puppeteer.launch(browserLaunchOptions);
  
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
        if (store.name === 'Flipkart Supermart') {
            await page.keyboard.type(pincode.toString());
            await page.keyboard.press("Enter");
        } else if (store.name === 'D Mart') {
            try {
                await page.waitForSelector('#pincodeInput', { timeout: 2000 });
            } catch (error) {
                await page.click('.header_pincode__KryhE');
                await page.waitForSelector('#pincodeInput', { timeout: 2000 });
            }
            await page.type('#pincodeInput', pincode.toString());
            await page.keyboard.press("Enter");
            await delay(500); // Wait for 1/2 sec
            await page.waitForSelector('.pincode-widget_pincode-list___pWVx .pincode-widget_pincode-item__qsZwZ:first-child button', { timeout: 2000 });
            await page.click('.pincode-widget_pincode-list___pWVx .pincode-widget_pincode-item__qsZwZ:first-child button');
            await page.waitForSelector('.pincode-widget_success-cntr-footer__Zo7iY button', { timeout: 2000 });
            await page.click('.pincode-widget_success-cntr-footer__Zo7iY button');
            await delay(1000);
            await page.waitForSelector("#scrInput");
            await page.type("#scrInput", productName);
            await page.keyboard.press("Enter");
        } else if (store.name === 'Amazon Fresh') {
            await page.waitForSelector("#nav-global-location-popover-link");
            await page.click("#nav-global-location-popover-link");
            await page.waitForSelector("#GLUXZipInputSection #GLUXZipUpdateInput")
            await page.click("#GLUXZipInputSection #GLUXZipUpdateInput")
        
            for (const char of pincode.toString()) {
                await page.type("#GLUXZipInputSection #GLUXZipUpdateInput", char);
                await delay(100) // Add a small delay between each character
            }
            await page.keyboard.press("Enter");
        } else if (store.name === 'Jio Mart') {
            await page.waitForSelector("#btn_pin_code_delivery");
            await page.click("#btn_pin_code_delivery");
            await page.waitForSelector('#btn_enter_pincode');
            await page.click("#btn_enter_pincode");
            await page.waitForSelector("#rel_pincode");
            for (const char of pincode.toString()) {
                await page.type("#rel_pincode", char);
                await delay(100) // Add a small delay between each character
            }
            await page.keyboard.press("Enter");
        }
    
        await delay(3000); // Wait to add checking for availability

        /*
        For Debugging

        // Take a full page screenshot
        const screenshot = await page.screenshot({ encoding: 'base64' });

        // Create a directory for screenshots if it doesn't exist
        const screenshotDir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir);
        }
    
        // Generate a unique filename
        const filename = `${store.name.replace(/\s+/g, '_')}_${Date.now()}.png`;
        const filepath = path.join(screenshotDir, filename);
    
        // Write the base64 encoded string to a file
        fs.writeFileSync(filepath, screenshot, 'base64');
        console.log(`Screenshot saved: ${filepath}`);
        */
        const screenshot = await page.screenshot({ encoding: 'base64' });
        const products = await analyzeScreenshot(store.name, productName, screenshot);
        await page.close();
        return products;
    })

    const productsListList = await Promise.all(productsPromises);
    for (const productList of productsListList) {
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
    console.log("Tokens used:", response.usage.prompt_tokens);
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

async function findCheapestProducts(productName, pincode) {
    return await searchProduct(productName, pincode);
}

(async () => {
    console.log("Please hold tight while we are fetching the results...");
    const chepestProduct = await findCheapestProducts("amul ghee 1l", 411057);
    console.log("Chepest product: ", chepestProduct);
})();
