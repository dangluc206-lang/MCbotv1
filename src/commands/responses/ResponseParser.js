'use strict';
class ResponseParser{parse(message,rule={}){const text=String(message||'');if(!rule.regex)return{text};const match=new RegExp(rule.regex,rule.flags||'i').exec(text);return match?{text,groups:match.groups||{},captures:match.slice(1)}:null;}}
module.exports=ResponseParser;
