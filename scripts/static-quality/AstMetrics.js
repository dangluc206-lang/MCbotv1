'use strict';

const acorn = require('acorn');

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const STATEMENT_TYPES = new Set([
    'BreakStatement', 'ContinueStatement', 'DebuggerStatement', 'DoWhileStatement', 'EmptyStatement',
    'ExpressionStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'IfStatement',
    'LabeledStatement', 'ReturnStatement', 'SwitchStatement', 'ThrowStatement', 'TryStatement',
    'VariableDeclaration', 'WhileStatement', 'WithStatement'
]);

function isNode(value) {
    return Boolean(value && typeof value === 'object' && typeof value.type === 'string');
}

function childEntries(node) {
    const children = [];
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) {
            for (const child of value) if (isNode(child)) children.push([key, child]);
        } else if (isNode(value)) children.push([key, value]);
    }
    return children;
}

function memberName(node) {
    if (!node) return null;
    if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name;
    if (node.type !== 'MemberExpression') return null;
    const object = memberName(node.object);
    const property = node.computed ? node.property?.value : memberName(node.property);
    return object && property !== undefined && property !== null ? `${object}.${property}` : null;
}

function functionName(node, parent, sequence) {
    if (node.id?.name) return node.id.name;
    if (parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') {
        const prefix = parent.static ? 'static ' : '';
        const key = parent.key?.name || parent.key?.value || '<computed>';
        const kind = parent.kind === 'get' || parent.kind === 'set' ? `${parent.kind} ` : '';
        return `${prefix}${kind}${key}`;
    }
    if (parent?.type === 'Property') return String(parent.key?.name || parent.key?.value || '<computed>');
    if (parent?.type === 'VariableDeclarator') return String(parent.id?.name || '<destructured>');
    if (parent?.type === 'AssignmentExpression') return memberName(parent.left) || '<assigned-function>';
    return `<anonymous@${node.loc?.start?.line || sequence}>`;
}

function complexityIncrement(node) {
    if (['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'CatchClause', 'ConditionalExpression'].includes(node.type)) return 1;
    if (node.type === 'SwitchCase' && node.test) return 1;
    if (node.type === 'LogicalExpression' && ['&&', '||', '??'].includes(node.operator)) return 1;
    return 0;
}

function measureFunction(node, name) {
    let statements = 0;
    let complexity = 1;
    function visit(current, root = false) {
        if (!root && FUNCTION_TYPES.has(current.type)) return;
        if (STATEMENT_TYPES.has(current.type)) statements += 1;
        complexity += complexityIncrement(current);
        for (const [, child] of childEntries(current)) visit(child);
    }
    visit(node, true);
    return Object.freeze({
        name,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        lines: node.loc.end.line - node.loc.start.line + 1,
        statements,
        complexity
    });
}

function analyze(source) {
    const comments = [];
    const ast = acorn.parse(source, {
        ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true, onComment: comments
    });
    const functions = [];
    const calls = [];
    let sequence = 0;
    function visit(node, parent = null) {
        sequence += 1;
        if (FUNCTION_TYPES.has(node.type)) functions.push(measureFunction(node, functionName(node, parent, sequence)));
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
            calls.push(Object.freeze({
                kind: node.type === 'NewExpression' ? 'new' : 'call',
                callee: memberName(node.callee),
                line: node.loc.start.line
            }));
        }
        for (const [, child] of childEntries(node)) visit(child, node);
    }
    visit(ast);
    return Object.freeze({
        ast,
        functions: Object.freeze(functions),
        calls: Object.freeze(calls),
        comments: Object.freeze(comments.map(comment => Object.freeze({ value: comment.value, line: comment.loc.start.line })))
    });
}

module.exports = Object.freeze({ analyze, memberName, measureFunction });
