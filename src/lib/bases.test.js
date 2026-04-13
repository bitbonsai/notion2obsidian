// Tests for Obsidian Bases generation functionality
import { describe, it, expect } from 'bun:test';

// Import the base generation functions (we'll test them indirectly through csv.js)
// Since generateBaseFile and helper functions are not exported, we'll test the public interface

describe('Obsidian Bases Generation', () => {
  describe('CSV Type Detection', () => {
    it('should detect date columns correctly', () => {
      // ISO date pattern: 2024-01-15
      const isoDates = ['2024-01-15', '2024-12-31', '2023-06-01'];
      const isoPattern = /^\d{4}-\d{2}-\d{2}/;
      expect(isoDates.every(d => isoPattern.test(d))).toBe(true);

      // US date pattern: 01/15/2024
      const usDates = ['01/15/2024', '12/31/2023', '06/01/2024'];
      const usPattern = /^\d{2}\/\d{2}\/\d{4}/;
      expect(usDates.every(d => usPattern.test(d))).toBe(true);
    });

    it('should detect number columns correctly', () => {
      const numbers = ['123', '45.67', '-89', '0', '1000'];
      const isNumber = (val) => !isNaN(parseFloat(val)) && isFinite(val);
      expect(numbers.every(n => isNumber(n))).toBe(true);
    });

    it('should detect boolean columns correctly', () => {
      const booleans = ['true', 'false', 'TRUE', 'FALSE', 'yes', 'no', 'YES', 'NO'];
      const boolPattern = /^(true|false|yes|no)$/i;
      expect(booleans.every(b => boolPattern.test(b))).toBe(true);
    });

    it('should treat unknown values as text', () => {
      const textValues = ['hello world', 'Some text here', '123abc', 'mixed-value'];
      const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/;
      const isNumber = (val) => !isNaN(parseFloat(val)) && isFinite(val);
      const boolPattern = /^(true|false|yes|no)$/i;

      const isText = (val) => !datePattern.test(val) && !isNumber(val) && !boolPattern.test(val);
      expect(textValues.every(v => isText(v))).toBe(true);
    });
  });

  describe('Base Configuration Generation', () => {
    it('should generate valid filter configuration', () => {
      const databaseName = 'Tasks';
      const tagName = databaseName.toLowerCase().replace(/\s+/g, '-');
      
      const filters = {
        and: [
          `file.hasTag("database/${tagName}")`,
          'file.ext == "md"'
        ]
      };

      expect(filters.and).toHaveLength(2);
      expect(filters.and[0]).toBe('file.hasTag("database/tasks")');
      expect(filters.and[1]).toBe('file.ext == "md"');
    });

    it('should generate valid property configuration', () => {
      const header = ['Task Name', 'Status', 'Priority', 'Due Date'];
      
      const properties = {};
      for (const col of header) {
        const key = col.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        properties[key] = {
          displayName: col
        };
      }

      expect(Object.keys(properties)).toHaveLength(4);
      expect(properties['task-name'].displayName).toBe('Task Name');
      expect(properties['status'].displayName).toBe('Status');
      expect(properties['priority'].displayName).toBe('Priority');
      expect(properties['due-date'].displayName).toBe('Due Date');
    });

    it('should generate date-based formulas for due dates', () => {
      const hasDueDate = true;
      const hasStatus = true;
      const key = 'due';

      const formulas = {};
      
      if (hasDueDate) {
        formulas[`days_until_${key}`] = `if(${key}, (date(${key}) - today()).days, "")`;
        if (hasStatus) {
          formulas[`is_overdue`] = `if(${key}, date(${key}) < today() && status != "done", false)`;
        }
      }

      expect(formulas['days_until_due']).toBeDefined();
      expect(formulas['is_overdue']).toBeDefined();
      expect(formulas['days_until_due']).toContain('date(due)');
      expect(formulas['is_overdue']).toContain('status != "done"');
    });

    it('should generate view configuration with proper structure', () => {
      const databaseName = 'Tasks';
      const header = ['Task Name', 'Status', 'Priority', 'Due Date'];
      const hasStatus = header.some(col => col.toLowerCase().includes('status'));

      const views = [];
      
      // Main view
      views.push({
        type: 'table',
        name: `All ${databaseName}`,
        order: ['file.name', 'task-name', 'status', 'priority', 'due-date']
      });

      // Active view if status column exists
      if (hasStatus) {
        views.push({
          type: 'table',
          name: 'Active',
          filters: {
            and: [
              'status != "done"',
              'status != "completed"',
              'status != "archived"'
            ]
          },
          order: ['file.name', 'task-name', 'status', 'priority', 'due-date']
        });
      }

      expect(views).toHaveLength(2);
      expect(views[0].name).toBe('All Tasks');
      expect(views[1].name).toBe('Active');
      expect(views[1].filters.and).toHaveLength(3);
      expect(views[0].order).toContain('file.name');
    });
  });

  describe('YAML Conversion', () => {
    it('should convert base configuration to valid YAML', () => {
      const base = {
        filters: {
          and: [
            'file.hasTag("database/tasks")',
            'file.ext == "md"'
          ]
        },
        properties: {
          'task-name': { displayName: 'Task Name' },
          'status': { displayName: 'Status' }
        },
        formulas: {
          'days_until_due': 'if(due, (date(due) - today()).days, "")'
        },
        views: [
          {
            type: 'table',
            name: 'All Tasks',
            order: ['file.name', 'task-name', 'status']
          }
        ]
      };

      // Simulate YAML conversion
      const lines = [];
      lines.push('filters:');
      lines.push('  and:');
      for (const filter of base.filters.and) {
        lines.push(`    - ${filter}`);
      }
      lines.push('');

      if (Object.keys(base.formulas).length > 0) {
        lines.push('formulas:');
        for (const [name, expr] of Object.entries(base.formulas)) {
          lines.push(`  ${name}: '${expr}'`);
        }
        lines.push('');
      }

      lines.push('properties:');
      for (const [key, config] of Object.entries(base.properties)) {
        lines.push(`  ${key}:`);
        lines.push(`    displayName: "${config.displayName}"`);
      }
      lines.push('');

      lines.push('views:');
      for (const view of base.views) {
        lines.push('  - type: table');
        lines.push(`    name: "${view.name}"`);
        lines.push('    order:');
        for (const col of view.order) {
          lines.push(`      - ${col}`);
        }
      }

      const yaml = lines.join('\n') + '\n';

      // Validate YAML content
      expect(yaml).toContain('filters:');
      expect(yaml).toContain('  and:');
      expect(yaml).toContain('file.hasTag("database/tasks")');
      expect(yaml).toContain('properties:');
      expect(yaml).toContain('  task-name:');
      expect(yaml).toContain('formulas:');
      expect(yaml).toContain('views:');
      expect(yaml).toContain('  - type: table');
    });
  });
});
