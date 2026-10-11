import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [1280,375,320]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.goto('http://localhost:5173/tests/fixtures/email-code-input.html');
 const input=page.getByLabel('Код из письма');await input.fill('034217');
 assert.deepEqual(await page.locator('[data-code-cell]').allTextContents(),['0','3','4','2','1','7']);
 await input.press('Enter');assert.equal(await page.evaluate(()=>window.submitted),'034217');
 await input.press('Control+a');await input.press('Backspace');await input.pressSequentially('012345');
 await input.press('ArrowLeft');await input.press('Backspace');assert.equal(await input.inputValue(),'01235');
 await input.evaluate(el=>{const clipboardData=new DataTransfer();clipboardData.setData('text','0 98-765');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData}));});
 assert.equal(await input.inputValue(),'098765');
 const bounds=await input.boundingBox();await input.click({position:{x:bounds.width*2.5/6,y:bounds.height/2}});await input.press('1');
 assert.equal(await input.inputValue(),'091765','click selects the intended digit');
 const metrics=await page.locator('[data-code-cell]').first().evaluate(el=>({font:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight,color:getComputedStyle(el).color,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
 assert.equal(metrics.color,'rgb(0, 0, 0)');assert.ok(Number(metrics.weight)>=700);assert.ok(parseFloat(metrics.font)>=24);assert.ok(Math.abs(metrics.w-metrics.h)<1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.close();
}console.log('email_code_input_passed: six bold black squares, leading zero, paste, keyboard edit, click edit, Enter, 320px mobile');}finally{await browser.close()}
