// src/layouts/AppLayout.jsx
import { Outlet } from 'react-router-dom';
import { Container, Row, Col } from 'react-bootstrap';
import Sidebar from '../components/sidebar';

export default function AppLayout() {
  return (
    <Container fluid className="app-layout">
      <Row>
        <Col md={2} className="app-sidebar bg-white vh-100 p-3 text-dark">
          <Sidebar />
        </Col>
        <Col md={10} style={{ backgroundColor: '#F5F5F5' }} className="app-content p-4">
          <Outlet />
        </Col>
      </Row>
    </Container>
  );
}
