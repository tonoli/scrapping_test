const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

async function findPuzzlePosition (page) {
    let images = await page.$$eval('.geetest_canvas_img canvas', canvases => canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, '')))

    await fs.writeFile(`./puzzle.png`, images[1], 'base64')

    let srcPuzzleImage = await Jimp.read('./puzzle.png')
    let srcPuzzle = cv.matFromImageData(srcPuzzleImage.bitmap)
    let dstPuzzle = new cv.Mat()

    cv.cvtColor(srcPuzzle, srcPuzzle, cv.COLOR_BGR2GRAY)
    cv.threshold(srcPuzzle, dstPuzzle, 127, 255, cv.THRESH_BINARY)

    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)
    cv.dilate(dstPuzzle, dstPuzzle, kernel, anchor, 1)
    cv.erode(dstPuzzle, dstPuzzle, kernel, anchor, 1)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dstPuzzle, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function findDiffPosition (page) {
    await page.waitForTimeout(100)

    let srcImage = await Jimp.read('./diff.png')
    let src = cv.matFromImageData(srcImage.bitmap)

    let dst = new cv.Mat()
    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)

    cv.threshold(src, dst, 127, 255, cv.THRESH_BINARY)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)

    cv.cvtColor(dst, dst, cv.COLOR_BGR2GRAY)
    cv.threshold(dst, dst, 150, 255, cv.THRESH_BINARY_INV)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function saveSliderCaptchaImages(page) {

    await page.waitForSelector('[aria-label="Click to verify"]', {
        timeout: 0})
    await page.waitForTimeout(1000)

    await page.click('[aria-label="Click to verify"]'
    )

    await page.waitForSelector('.geetest_canvas_img canvas', { visible: true })
    await page.waitForTimeout(1000)
    let images = await page.$$eval('.geetest_canvas_img canvas', canvases => {
        return canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, ''))
    })

    await fs.writeFile(`./captcha.png`, images[0], 'base64')
    await fs.writeFile(`./original.png`, images[2], 'base64')
}

async function saveDiffImage() {
    const originalImage = await Jimp.read('./original.png')
    const captchaImage = await Jimp.read('./captcha.png')

    const { width, height } = originalImage.bitmap
    const diffImage = new Jimp(width, height)

    const diffOptions = { includeAA: true, threshold: 0.2 }

    pixelmatch(originalImage.bitmap.data, captchaImage.bitmap.data, diffImage.bitmap.data, width, height, diffOptions)
    diffImage.write('./diff.png')
}

async function run () {
    const puppeteerInstance = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1366, height: 768 },
        args: ['--disable-features=site-per-process']
    })
    const browser = await puppeteerInstance.newPage()

    await browser.goto('https://www.darty.com/nav/achat/gros_electromenager/lave-linge/index.html', { waitUntil: 'networkidle2' })

    await browser.waitForTimeout(1000)
    const page = await browser.frames().find(frame => {
        return frame.url().includes('https://geo.captcha-delivery.com')
    });
    await saveSliderCaptchaImages(page)
    await saveDiffImage()

    let [cx, cy] = await findDiffPosition(page)

    const sliderHandle = await page.$('.geetest_slider_button')
    const handle = await sliderHandle.boundingBox()

    let xPosition = handle.x + handle.width / 2
    let yPosition = handle.y + handle.height / 2
    await browser.mouse.move(xPosition, yPosition)
    await browser.mouse.down()

    xPosition = handle.x + cx - handle.width / 2
    yPosition = handle.y + handle.height / 3
    await browser.mouse.move(xPosition, yPosition, { steps: 25 })

    await browser.waitForTimeout(100)

    let [cxPuzzle, cyPuzzle] = await findPuzzlePosition(page)

    xPosition = xPosition + cx - cxPuzzle
    yPosition = handle.y + handle.height / 2
    await browser.mouse.move(xPosition, yPosition, { steps: 5 })
    await browser.mouse.up()

    await browser.waitForTimeout(3000)

    await fs.unlink('./original.png')
    await fs.unlink('./captcha.png')
    await fs.unlink('./diff.png')
    await fs.unlink('./puzzle.png')

}

run();