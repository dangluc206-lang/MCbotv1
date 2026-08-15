'use strict';

class StorageTextParser {
    normalizeText(value) {
        const smallCaps = {
            'ᴋ': 'k', 'ʜ': 'h', 'ᴏ': 'o', 'ᴄ': 'c', 'ᴜ': 'u', 'ѕ': 's',
            'ʀ': 'r', 'ᴇ': 'e', 'ɴ': 'n', 'ɪ': 'i', 'ᴍ': 'm', 'ᴀ': 'a',
            'ʟ': 'l', 'ᴛ': 't', 'ᴘ': 'p', 'ᴅ': 'd', 'ɢ': 'g', 'ʙ': 'b',
            'ғ': 'f', 'ᴠ': 'v', 'ʏ': 'y', 'ᴡ': 'w', 'x': 'x'
        };

        return String(value ?? '')
            .replace(/§[0-9a-fk-or]/gi, '')
            .replace(/[ᴋʜᴏᴄᴜѕʀᴇɴɪᴍᴀʟᴛᴘᴅɢʙғᴠʏᴡ]/g, character => smallCaps[character] || character)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    itemLines(item) {
        const values = [];
        const seen = new Set();
        const collect = (value, depth = 0) => {
            if (depth > 24 || value === null || value === undefined || values.length >= 96) return;
            if (typeof value === 'string') {
                const text = value.replace(/[\r\n\t]+/g, ' ').trim();
                if (!text || text.startsWith('minecraft:')) return;

                if ((text.startsWith('{') || text.startsWith('[')) && text.length <= 20000) {
                    try {
                        collect(JSON.parse(text), depth + 1);
                        return;
                    } catch {
                        // Plain text can legitimately begin with a brace.
                    }
                }
                values.push(text);
                return;
            }
            if (typeof value !== 'object') return;
            if (seen.has(value)) return;
            seen.add(value);

            if (Array.isArray(value)) {
                for (const entry of value) collect(entry, depth + 1);
                return;
            }
            if (value instanceof Map) {
                for (const entry of value.values()) collect(entry?.data ?? entry, depth + 1);
                return;
            }

            // prismarine-chat and several protocol adapters expose useful text
            // only through a custom toString(). Keep traversing fields too.
            if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
                try {
                    const rendered = value.toString();
                    if (rendered && !/^\[object\s.+\]$/.test(rendered)) collect(rendered, depth + 1);
                } catch {
                    // Continue with enumerable fields.
                }
            }

            if (value.type === 'string') {
                collect(value.value, depth + 1);
                return;
            }
            if (value.type === 'list' || value.type === 'compound') {
                collect(value.value, depth + 1);
                return;
            }
            if (Object.prototype.hasOwnProperty.call(value, 'value') && Object.keys(value).length <= 3) {
                collect(value.value, depth + 1);
                return;
            }

            for (const entry of Object.values(value)) collect(entry, depth + 1);
        };

        collect(item?.displayName);
        collect(item?.customName);
        collect(item?.lore);
        collect(item?.customLore);
        collect(item?.nbt);
        collect(item?.components);
        if (item?.componentMap instanceof Map) {
            for (const component of item.componentMap.values()) collect(component?.data ?? component);
        }

        return [...new Set(values)].slice(0, 48);
    }

    itemText(item) {
        return this.normalizeText(this.itemLines(item).join('\n'));
    }

    parseNumber(value) {
        if (value === null || value === undefined) return null;
        const digits = String(value).replace(/[^0-9-]/g, '');
        if (!digits || digits === '-') return null;
        const parsed = Number(digits);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }

    parsePercent(value) {
        if (value === null || value === undefined) return null;
        const match = /-?[\d.,]+/.exec(String(value));
        if (!match) return null;
        const parsed = Number(match[0].replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
    }

    firstMatch(text, patterns = [], group = 'value') {
        for (const pattern of patterns) {
            const regex = new RegExp(pattern, 'i');
            const match = regex.exec(text);
            if (!match) continue;
            const raw = match.groups?.[group] ?? match[1];
            const parsed = this.parseNumber(raw);
            if (parsed !== null) return parsed;
        }
        return null;
    }

    firstNumberAfterLabel(lines, labelExpression, maxOffset = 6) {
        const normalizedLines = (Array.isArray(lines) ? lines : []).map(line => this.normalizeText(line));
        const index = normalizedLines.findIndex(line => {
            labelExpression.lastIndex = 0;
            return labelExpression.test(line);
        });
        if (index < 0) return null;

        // Number can be on the same line or separated into later chat/data
        // components by resource-pack formatting (label -> color -> number).
        const sameLine = /([\d][\d.,]*)/.exec(normalizedLines[index]);
        if (sameLine) {
            const parsed = this.parseNumber(sameLine[1]);
            if (parsed !== null) return parsed;
        }

        for (let offset = 1; offset <= maxOffset && index + offset < normalizedLines.length; offset += 1) {
            const match = /([\d][\d.,]*)/.exec(normalizedLines[index + offset]);
            const parsed = this.parseNumber(match?.[1]);
            if (parsed !== null) return parsed;
        }
        return null;
    }

    firstPercentAfterLabel(lines, labelExpression, maxOffset = 6) {
        const normalizedLines = (Array.isArray(lines) ? lines : []).map(line => this.normalizeText(line));
        const index = normalizedLines.findIndex(line => {
            labelExpression.lastIndex = 0;
            return labelExpression.test(line);
        });
        if (index < 0) return null;

        for (let offset = 0; offset <= maxOffset && index + offset < normalizedLines.length; offset += 1) {
            const match = /([\d]+(?:[.,][\d]+)?)\s*%/.exec(normalizedLines[index + offset]);
            const parsed = this.parsePercent(match?.[1]);
            if (parsed !== null) return parsed;
        }
        return null;
    }

}

module.exports = StorageTextParser;
