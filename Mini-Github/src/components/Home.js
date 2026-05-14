import React from 'react';
import { Link } from 'react-router-dom';

function Home() {
  return (
    <div>
      <div className="form-title">Welcome to Mini GitHub</div>
      <p style={{textAlign: 'center', marginBottom: 32, color: '#444'}}>
        A simple platform to sign up, log in, and upload your files like a mini GitHub.
      </p>
      <Link className="link" to="/login">
        <button style={{marginBottom: 16}}>Login</button>
      </Link>
      <Link className="link" to="/signup">
        <button>Sign Up</button>
      </Link>
    </div>
  );
}

export default Home;
