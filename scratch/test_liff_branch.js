const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '../public/liff/missing-info.html');
const content = fs.readFileSync(htmlPath, 'utf8');

console.log('1. Checking HTML structure...');
if (!content.includes('id="customerBranch"')) {
    throw new Error('Missing customerBranch element');
}
if (!content.includes('select id="customerBranch"')) {
    throw new Error('customerBranch is not a select element');
}
if (!content.includes('id="branchNumber"')) {
    throw new Error('Missing branchNumber element');
}
if (!content.includes('id="lockBranchNum"')) {
    throw new Error('Missing lockBranchNum element');
}
console.log('✓ HTML structure checks passed.');

console.log('2. Checking CSS custom select rule...');
if (!content.includes('select.field-input')) {
    throw new Error('Missing CSS rules for select.field-input');
}
console.log('✓ CSS custom select rule checked.');

console.log('3. Extracting and compiling inline JavaScript...');
const scriptStartIdx = content.indexOf('<script>');
const scriptEndIdx = content.indexOf('</script>', scriptStartIdx);

if (scriptStartIdx === -1 || scriptEndIdx === -1) {
    throw new Error('Could not find <script> tag');
}

const jsCode = content.substring(scriptStartIdx + 8, scriptEndIdx);

try {
    new vm.Script(jsCode);
    console.log('✓ Inline JavaScript successfully parsed and compiled with no syntax errors.');
} catch (e) {
    console.error('❌ JavaScript Syntax Error:', e);
    process.exit(1);
}

console.log('All automated checks passed successfully!');
