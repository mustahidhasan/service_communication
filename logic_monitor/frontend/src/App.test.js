import { render, screen } from '@testing-library/react';
import App from './App';

test('renders SSO login button', () => {
  render(<App />);
  const heading = screen.getByText(/Log In/i);
  const button = screen.getByText(/login via sso/i);
  expect(heading).toBeInTheDocument();
  expect(button).toBeInTheDocument();
});
