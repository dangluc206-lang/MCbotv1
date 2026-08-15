'use strict';
class CompositeItemMatcher{constructor(matchers={}){this.matchers=matchers;}match(item,rules=[]){const details=[];for(const rule of rules){const matcher=this.matchers[rule.type];if(!matcher)return{matched:false,strength:'NONE',reason:`Unknown matcher: ${rule.type}`,details};const result=matcher.match(item,rule);details.push(result);if(!result.matched)return{matched:false,strength:result.strength,reason:`Rule failed: ${rule.type}`,details};}return{matched:true,strength:details[0]?.strength||'NONE',reason:'All rules matched',details};}}
module.exports=CompositeItemMatcher;
