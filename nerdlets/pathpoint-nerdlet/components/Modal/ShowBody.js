import React, { Component } from 'react';
import PropTypes from 'prop-types';

// IMPORT ICONS
import graphImage from '../../images/graph.png';

// IMPORT COMPONENTS
import { BodyTuneFormModal } from './TuneFormModal';
import { BodyLogoFormModal } from './LogoFormModal';
import { BodyQueryFormModal } from './QueryFormModal';
import { BodyFlameFormModal } from './FlameFormModal';
import { BodyCanaryFormModal } from './CanaryFormModal';
import { BodySupportFormModal } from './SupportFormModal';
import { BodyFileErrorFormModal } from './FileErrorFormModal';
import { BodyJsonConfigurationFormModal } from './JsonConfigurationFormModal';
import { BodyBackgroundProcessesFormModal } from './BackgroundProcessesFormModal';
export default class ShowBody extends Component {
  constructor(props) {
    super(props);
    this.state = {
      url: '',
      text: '',
      type: ''
    };
  }

  handleOnChange = (type, event) => {
    if (type === 'select') {
      this.setState({ type: event.label });
    } else {
      this.setState({ [event.target.name]: event.target.value });
    }
  };

  handleSubmitLogo = event => {
    event.preventDefault();
    const { url, text, type } = this.state;
    const { LogoFormSubmit, _onClose } = this.props;
    console.log('url', url, 'text', text, 'type', type);
    LogoFormSubmit({ url, text, type }, _onClose);
  };

  showBodyRender = () => {
    const { type } = this.state;
    const { viewModal } = this.props;
    switch (viewModal) {
      case 0:
        return <img src={graphImage} />;
      case 1:
        return <BodyQueryFormModal {...this.props} />;
      case 2:
        return <BodyTuneFormModal {...this.props} />;
      case 3:
        return <div />;
      case 4:
        return <BodyJsonConfigurationFormModal {...this.props} />;
      case 5:
        return <BodySupportFormModal {...this.props} />;
      case 6:
        return <BodyCanaryFormModal {...this.props} />;
      case 7:
        return <BodyFlameFormModal {...this.props} />;
      case 8:
        return <BodyFileErrorFormModal {...this.props} />;
      case 9:
        return <BodyBackgroundProcessesFormModal {...this.props} />;
      case 10:
        return (
          <BodyLogoFormModal
            handleSubmitLogo={this.handleSubmitLogo}
            handleOnChange={this.handleOnChange}
            type={type}
          />
        );
    }
  };

  render() {
    return this.showBodyRender();
  }
}

ShowBody.propTypes = {
  viewModal: PropTypes.number.isRequired,
  LogoFormSubmit: PropTypes.func.isRequired,
  _onClose: PropTypes.func.isRequired
};
