'use strict';
class ResponseMatcher{match(message,rules=[]){const text=String(message||'');for(const rule of rules){if(rule.regex&&new RegExp(rule.regex,rule.flags||'i').test(text))return{matched:true,rule};if(rule.includes&&text.toLowerCase().includes(String(rule.includes).toLowerCase()))return{matched:true,rule};}return{matched:false,rule:null};}}
module.exports=ResponseMatcher;
