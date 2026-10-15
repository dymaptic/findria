// Test setup file
// Set up environment variables for testing
// Note: NODE_ENV is typically set via CLI, not here

// Mock console.error to reduce noise in tests (optional)
// const originalConsoleError = console.error;
// beforeAll(() => {
//   console.error = jest.fn();
// });
// afterAll(() => {
//   console.error = originalConsoleError;
// });

// Clear rate limiter between tests
import { rateLimiter } from '@/lib/rate-limiter';

afterEach(() => {
  rateLimiter.clear();
});
