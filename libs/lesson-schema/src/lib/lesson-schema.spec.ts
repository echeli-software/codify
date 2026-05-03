import { lessonSchema } from './lesson-schema.js';

describe('lessonSchema', () => {
  it('should work', () => {
    expect(lessonSchema()).toEqual('lesson-schema');
  });
});
